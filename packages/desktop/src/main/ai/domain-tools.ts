import type { PiModule, TypeBoxModule } from './pi-loader'
import type { AiDraftPayload, AiSuggestionPayload } from '../../shared/desktop'

export type AskUserFn = (question: string, options: string[] | undefined) => Promise<string>
/** AI 产出的唯一出口：不直接改状态，只写入运行产出缓冲（人机边界）。 */
export type CollectFn = (item: { kind: 'suggestion'; payload: AiSuggestionPayload } | { kind: 'draft'; payload: AiDraftPayload }) => void

export interface DomainToolDeps {
  askUser: AskUserFn
  collect: CollectFn
}

const TOOL_NAMES = ['write_suggestion', 'write_master_draft', 'ask_user'] as const
export type DomainToolName = (typeof TOOL_NAMES)[number]
export function domainToolNames(): readonly DomainToolName[] {
  return TOOL_NAMES
}

// pi 的 AgentToolResult.details 为必填属性（日志/UI 用，模型不可见）——undefined 即可。
function text(t: string) {
  return { content: [{ type: 'text' as const, text: t }], details: undefined }
}
function textErr(t: string) {
  return { content: [{ type: 'text' as const, text: t }], details: undefined, isError: true }
}

export async function buildDomainTools(pi: PiModule, T: TypeBoxModule, deps: DomainToolDeps) {
  const writeSuggestionTool = pi.defineTool({
    name: 'write_suggestion',
    label: '记录修改建议',
    description:
      '把对当前文稿的一段修改建议记录为待采用条目。original 必须是正文中逐字存在的一句原文；replacement 是改写后的句子。建议不会自动改正文，作者逐条决定采用或保留原文。',
    parameters: T.Type.Object({
      platform: T.Type.String({ description: '目标平台 id：master/wechat/redbook/zhihu/douyin/x' }),
      original: T.Type.String({ description: '正文中逐字存在的原句' }),
      replacement: T.Type.String({ description: '改写后的句子' }),
      note: T.Type.Optional(T.Type.String({ description: '一句话说明修改理由' })),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
    async execute(_id, params) {
      if (!params.original.trim() || !params.replacement.trim()) return textErr('original 与 replacement 都不能为空。')
      deps.collect({ kind: 'suggestion', payload: params })
      return text('建议已记录，等待作者采用；正文保持不变。')
    },
  })

  const writeMasterDraftTool = pi.defineTool({
    name: 'write_master_draft',
    label: '写入母稿候选',
    description:
      '把完整的母稿（Markdown 全文）写入候选区。这是 AI 产出的唯一落点：不修改现有正文，作者比较候选与原稿后决定是否采用。',
    parameters: T.Type.Object({
      title: T.Type.String({ description: '候选标题' }),
      body: T.Type.String({ description: '完整 Markdown 正文' }),
      note: T.Type.Optional(T.Type.String({ description: '候选备注，如「按方案生成」' })),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false },
    async execute(_id, params) {
      if (!params.body.trim()) return textErr('正文不能为空。')
      deps.collect({ kind: 'draft', payload: params })
      return text('候选已写入候选区，等待作者比较与采用；现有正文保持不变。')
    },
  })

  const askUserTool = pi.defineTool({
    name: 'ask_user',
    label: '问询用户',
    description: '向作者提一个问题（可给选项列表），等待回答。创作方向、取舍、事实不确定等决策拿不准时必须先问。',
    parameters: T.Type.Object({
      question: T.Type.String(),
      options: T.Type.Optional(T.Type.Array(T.Type.String())),
    }),
    annotations: { readOnlyHint: true },
    execute(_id, params, signal): Promise<ReturnType<typeof text>> {
      return new Promise((resolve) => {
        let settled = false
        const done = (t: string) => {
          if (!settled) {
            settled = true
            resolve(text(t))
          }
        }
        const onAbort = () => done('（任务已取消，未获得用户回答。）')
        signal?.addEventListener('abort', onAbort, { once: true })
        void deps.askUser(params.question, params.options).then((answer) => {
          signal?.removeEventListener('abort', onAbort)
          done(`用户回答：${answer}`)
        })
      })
    },
  })

  return [writeSuggestionTool, writeMasterDraftTool, askUserTool]
}
