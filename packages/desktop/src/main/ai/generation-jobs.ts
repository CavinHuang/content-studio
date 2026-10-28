import type { ModelConfig, AiDraftPayload } from '../../shared/desktop'
import type { MainExecutor } from '../tasks/runner'
import type { CreateSessionFn, SessionLike } from './agent-service'
import type { CollectFn } from './domain-tools'

const PLATFORM_GUIDES: Record<string, string> = {
  wechat: '公众号长文：完整结构与论证，保留观点深度，不硬性分段风格化。',
  redbook:
    '小红书笔记：吸引人的标题（不超过 20 字）、口语化正文、结尾给 3～6 个 # 话题标签（放在 tags 说明里，正文外单独一行以「话题：」开头给出）。',
  zhihu: '知乎回答：先直接回应问题，再分层展开论据，理性克制。',
  douyin: '抖音口播脚本：以「口播：」开头，短句、有钩子、约 300～500 字，另外用「话题：」行给出话题标签。',
  x: 'X 串文：以「串文：」开头，每段一行，共 3～6 段，简洁有力。',
}

export function buildSystemPrompt(): string {
  return [
    '你是一名中文内容创作助手，服务于独立创作者。',
    '铁律：不虚构事实；只依据用户提供的材料；作者观点与经历不得替写；产出必须经 write_master_draft 工具提交（候选），绝不直接声称已修改正文。',
    '输出要求：使用简体中文；Markdown 正文；标题与正文分开提交。',
  ].join('\n')
}

function buildCollect() {
  const drafts: AiDraftPayload[] = []
  const collect: CollectFn = (item) => {
    if (item.kind === 'draft') drafts.push(item.payload)
  }
  return { drafts, collect }
}

/**
 * 一次性会话生命周期（F04）：任务中止信号接到 session.abort()——
 * 创建完成后立即绑定，并覆盖"创建期间已停止"的竞态（先检查 aborted 再 prompt）；
 * prompt/waitForIdle 结束（正常、失败、中止）一律 dispose 恰好一次。
 * 返回 false 表示任务已中止、未执行 prompt。
 */
async function withOneShotSession(
  signal: AbortSignal,
  create: () => Promise<SessionLike>,
  run: (session: SessionLike) => Promise<void>,
): Promise<boolean> {
  if (signal.aborted) return false
  const session = await create()
  if (signal.aborted) {
    // 会话创建期间任务已被停止：不发起 prompt，直接释放。
    session.dispose()
    return false
  }
  const onAbort = () => {
    void session.abort().catch(() => {})
  }
  signal.addEventListener('abort', onAbort, { once: true })
  try {
    await run(session)
    return true
  } finally {
    signal.removeEventListener('abort', onAbort)
    session.dispose()
  }
}

/** 平台改写 job：逐平台一次性会话，模型经 write_master_draft 提交该平台版本。 */
export function createPlatformRewriteExecutor(deps: {
  createSession: CreateSessionFn
  getConfig(): ModelConfig | null
}): MainExecutor {
  return async (task, ctx) => {
    const payload = task.payload as {
      platforms: string[]
      masterTitle: string
      masterBody: string
      skip?: string[]
      tone?: string
      language?: string
    }
    if (!payload?.platforms?.length) return { state: 'failed', detail: '缺少平台列表。' }
    if (!deps.getConfig())
      return { state: 'failed', detail: '尚未配置模型，请先在「设置 → AI 服务」中配置。' }
    const skip = new Set(payload.skip ?? [])
    const targets = payload.platforms.filter((p) => !skip.has(p))
    const drafts: Record<string, { title: string; body: string; tags: string; question: string }> = {}
    const failed: string[] = []
    for (const platform of targets) {
      if (ctx.signal.aborted) return { state: 'failed', detail: '已中止。' }
      ctx.progress(`正在适配平台版本（${platform}）…`)
      const { drafts: collected, collect } = buildCollect()
      try {
        const prompted = await withOneShotSession(
          ctx.signal,
          () => deps.createSession(`gen:${task.id}-${platform}`, async () => '（无问询。）', collect),
          async (session) => {
            await session.prompt(
              [
                buildSystemPrompt(),
                `请把下面这篇母稿改写为「${platform}」平台版本。平台要求：${PLATFORM_GUIDES[platform] ?? '保持原意，按平台习惯改写。'}`,
                payload.tone ? `表达偏好：${payload.tone}。` : '',
                `完成后调用 write_master_draft 工具提交：title=该平台标题，body=该平台正文（含「话题：」行时保留在正文内），note=${platform}。`,
                '',
                `# ${payload.masterTitle}`,
                '',
                payload.masterBody,
              ]
                .filter(Boolean)
                .join('\n'),
            )
            await session.waitForIdle()
          },
        )
        // 中止（创建前后或请求中途被中断后正常返回）都不再进入下一平台；
        // 任务已停止时该返回会被 runner 的迟到结算拒绝语义丢弃。
        if (!prompted || ctx.signal.aborted) return { state: 'failed', detail: '已中止。' }
        const draft = collected.at(-1)
        if (draft) drafts[platform] = { title: draft.title, body: draft.body, tags: '', question: '' }
        else failed.push(platform)
      } catch {
        // 请求失败（含中止导致的中断）：记失败项；循环顶部统一检查中止。
        failed.push(platform)
      }
    }
    if (ctx.signal.aborted) return { state: 'failed', detail: '已中止。' }
    const result = { drafts, failed }
    if (!targets.length) return { state: 'complete', detail: '所选平台均已存在版本，未生成新内容。', result }
    if (failed.length === targets.length)
      return { state: 'failed', detail: `全部平台生成失败（${failed.join('、')}）。`, result }
    if (failed.length)
      return {
        // §12 部分完成：成功平台草稿可用，失败项列明、可重试
        state: 'partial',
        detail: `已生成 ${Object.keys(drafts).length} 个平台版本；失败：${failed.join('、')}。`,
        result,
      }
    return { state: 'complete', detail: `已生成 ${Object.keys(drafts).length} 个平台版本。`, result }
  }
}

/** 方案→母稿候选 job：产出 {title, body}，渲染端走 candidate 比较/采用流。 */
export function createMasterDraftExecutor(deps: {
  createSession: CreateSessionFn
  getConfig(): ModelConfig | null
}): MainExecutor {
  return async (task, ctx) => {
    const payload = task.payload as { briefText: string; materialsText?: string }
    if (!deps.getConfig())
      return { state: 'failed', detail: '尚未配置模型，请先在「设置 → AI 服务」中配置。' }
    if (!payload?.briefText?.trim()) return { state: 'failed', detail: '缺少创作方案。' }
    ctx.progress('正在按方案生成母稿候选…')
    const { drafts: collected, collect } = buildCollect()
    const prompted = await withOneShotSession(
      ctx.signal,
      () => deps.createSession(`gen:${task.id}`, async () => '（无问询。）', collect),
      async (session) => {
        await session.prompt(
          [
            buildSystemPrompt(),
            '请按下面的创作方案写出母稿。要求：忠于方案的观点与大纲；只用方案与材料中的信息；字数与方案建议一致。',
            '完成后调用 write_master_draft 工具提交候选（title=标题，body=Markdown 正文）。',
            '',
            payload.briefText,
            payload.materialsText ? `\n参考材料（可引用，不得虚构补充）：\n${payload.materialsText}` : '',
          ]
            .filter(Boolean)
            .join('\n'),
        )
        await session.waitForIdle()
      },
    )
    // 中止（含请求被中断）不回写完成：任务已停止时该返回会被 runner 丢弃。
    if (!prompted || ctx.signal.aborted) return { state: 'failed', detail: '已中止。' }
    const draft = collected.at(-1)
    if (!draft) return { state: 'failed', detail: '模型未提交候选。' }
    return { state: 'complete', detail: '母稿候选已生成，等待作者比较与采用。', result: draft }
  }
}
