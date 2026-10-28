/**
 * 小红书自包含注入脚本单测（jsdom + 本地夹具页）。
 * 铁律断言：所有场景下内容填充正确，且发布按钮点击数为 0（绝不点发布是代码路径级约束）。
 * 自包含铁律：脚本经 toString() 序列化 + eval 往返后仍可用（主进程 executeJavaScript 的真实执行路径）。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, expect, test } from 'vitest'
import {
  redbookInjectScript,
  type RedbookScriptPayload,
} from '../../packages/desktop/src/main/publish/redbook/inject-script'

const editorHtml = readFileSync(join(__dirname, '..', 'fixtures', 'redbook-editor.html'), 'utf8')
const loginHtml = readFileSync(join(__dirname, '..', 'fixtures', 'redbook-login.html'), 'utf8')

/** 夹具正文（不含 <script>，jsdom 单测由用例自己给发布按钮挂点击计数）。 */
function bodyOf(documentHtml: string): string {
  return /<body>([\s\S]*)<\/body>/.exec(documentHtml)![1]!.replace(/<script>[\s\S]*<\/script>/, '')
}

let publishClicks = 0

function loadPage(documentHtml: string): void {
  document.body.innerHTML = bodyOf(documentHtml)
  publishClicks = 0
  document.querySelector('.publish-btn')?.addEventListener('click', () => {
    publishClicks += 1
  })
}

function titleInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!
}

function editor(): HTMLElement {
  return document.querySelector<HTMLElement>('.ql-editor')!
}

const PAYLOAD = {
  title: '创作笔记的标题要超过二十个字吗？来数一数看吧',
  body: '一直想开始创作，却总觉得还没准备好？\n\n试着把创作拆成三个轻一点的动作。',
  topics: ['个人创作', '创作习惯'],
} as const

beforeEach(() => {
  document.body.innerHTML = ''
})

test('登录页（文案命中扫码登录）→ loginCheck 拒绝 NOT_LOGGED_IN，发布按钮未被点击', async () => {
  loadPage(loginHtml)
  const result = await redbookInjectScript({ kind: 'loginCheck' })
  expect(result).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' })
  expect(publishClicks).toBe(0)
})

test('URL 含 /login → 即便编辑器存在也判定未登录（登录前置）', async () => {
  loadPage(editorHtml)
  window.history.pushState({}, '', '/login')
  try {
    const result = await redbookInjectScript({ kind: 'loginCheck', timeoutMs: 300 })
    expect(result).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' })
    expect(publishClicks).toBe(0)
  } finally {
    window.history.pushState({}, '', '/')
  }
})

test('编辑器页注入：标题截断到 20 字、正文与话题追加填充、发布按钮点击数为 0', async () => {
  loadPage(editorHtml)
  const result = await redbookInjectScript({ kind: 'inject', ...PAYLOAD })
  expect(result.ok).toBe(true)
  if (!result.ok || result.kind !== 'inject') throw new Error('unreachable')
  // 标题超 20 字自动截断并出 warning（当前批次快照标题可能超限）
  expect(result.warnings).toEqual(['标题超过 20 字，已截断填充'])
  expect(titleInput().value).toBe(PAYLOAD.title.slice(0, 20))
  // 话题以「#」追加在正文尾（当前快照 tags → topics 结构）
  expect(editor().textContent).toBe(
    `${PAYLOAD.body}\n\n#${PAYLOAD.topics[0]} #${PAYLOAD.topics[1]}`,
  )
  expect(publishClicks).toBe(0)
})

test('自包含铁律：toString() 序列化 + eval 往返后注入仍生效（主进程真实执行路径）', async () => {
  loadPage(editorHtml)
  // eslint-disable-next-line no-eval
  const roundtrip = eval(`(${redbookInjectScript.toString()})`) as typeof redbookInjectScript
  const payload: RedbookScriptPayload = { kind: 'inject', ...PAYLOAD }
  const result = await roundtrip(payload)
  expect(result.ok).toBe(true)
  expect(titleInput().value).toBe(PAYLOAD.title.slice(0, 20))
  expect(editor().textContent).toContain(PAYLOAD.body)
  expect(publishClicks).toBe(0)
})

test('防覆盖：编辑器已有不一致内容 → ALREADY_HAS_CONTENT 拒绝且原内容不被改写', async () => {
  loadPage(editorHtml)
  titleInput().value = '别人写过的标题'
  editor().textContent = '编辑器里已有的正文内容。'
  const result = await redbookInjectScript({ kind: 'inject', ...PAYLOAD })
  expect(result).toMatchObject({ ok: false, code: 'ALREADY_HAS_CONTENT' })
  expect(result.ok ? null : result.message).toContain('为防覆盖已停止注入')
  expect(titleInput().value).toBe('别人写过的标题')
  expect(editor().textContent).toBe('编辑器里已有的正文内容。')
  expect(publishClicks).toBe(0)
})

test('幂等重试：同一负载再次注入视为重填，允许并保持一致', async () => {
  loadPage(editorHtml)
  const first = await redbookInjectScript({ kind: 'inject', ...PAYLOAD })
  expect(first.ok).toBe(true)
  const again = await redbookInjectScript({ kind: 'inject', ...PAYLOAD })
  expect(again.ok).toBe(true)
  expect(titleInput().value).toBe(PAYLOAD.title.slice(0, 20))
  expect(editor().textContent).toContain(PAYLOAD.body)
  expect(publishClicks).toBe(0)
})

test('readBack：注入后回读标题与正文字数', async () => {
  loadPage(editorHtml)
  await redbookInjectScript({ kind: 'inject', ...PAYLOAD })
  const result = await redbookInjectScript({ kind: 'readBack' })
  expect(result.ok).toBe(true)
  if (!result.ok || result.kind !== 'readBack') throw new Error('unreachable')
  expect(result.title).toBe(PAYLOAD.title.slice(0, 20))
  expect(result.bodyChars).toBeGreaterThan(PAYLOAD.body.length)
  expect(publishClicks).toBe(0)
})

test('页面结构变化：找不到标题框/编辑器 → PAGE_CHANGED（绝不静默）', async () => {
  document.body.innerHTML = '<main><p>发布成功，正在跳转…</p></main>'
  publishClicks = 0
  const result = await redbookInjectScript({ kind: 'inject', ...PAYLOAD, timeoutMs: 200 })
  expect(result).toMatchObject({ ok: false, code: 'PAGE_CHANGED' })
  expect(result.ok ? null : result.message).toContain('适配器需更新')
  expect(publishClicks).toBe(0)
})

test('话题列表去 # 去重：topics 带井号或重复项时正文尾话题仍正确', async () => {
  loadPage(editorHtml)
  const result = await redbookInjectScript({
    kind: 'inject',
    title: '短标题',
    body: '正文一段。',
    topics: ['#个人创作', '个人创作', '表达与记录'],
  })
  expect(result.ok).toBe(true)
  // 脚本侧剥掉首尾 #；重复项由执行器侧解析去重（此处直接传入重复仅验证剥 # 不炸）
  expect(editor().textContent).toContain('#个人创作 #个人创作 #表达与记录')
  expect(publishClicks).toBe(0)
})
