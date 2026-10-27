/**
 * 小红书创作服务平台页面注入脚本。
 *
 * 自包含约束（铁律）：不引用任何模块级变量/导入——本函数经 toString() 序列化后由主进程
 * webContents.executeJavaScript 在页面上下文执行（历史探针实证 eval('(' + fn.toString() + ')') 往返可行）。
 * 人机边界（铁律）：只填标题/正文/话题（话题以「#」追加在正文尾），绝不点击「发布」类按钮，
 * 不发起任何平台接口请求，只派发 UI 事件。
 * 防覆盖：编辑器已有内容且与本次负载不一致 ⇒ ALREADY_HAS_CONTENT 拒绝；一致视为幂等重试允许重填。
 * jsdom 29.1.1 无 DataTransfer/ClipboardEvent（历史探针事实）：粘贴路径有 typeof 守卫，回退 textContent+InputEvent。
 * 移植自 ref/cc0f351-inject-script-xiaohongshu.ts（本仓库自有历史资产，AGPL 边界内原创实现），
 * 适配当前批次快照结构：title/body 直取快照，topics 由 tags 原始串在执行器侧解析后传入。
 */
export type RedbookPayload =
  | { kind: 'loginCheck' }
  | { kind: 'inject'; title: string; body: string; topics: readonly string[] } // readonly：容纳测试 as const 负载；脚本只读不 mutate
  | { kind: 'readBack' }
export type RedbookResult =
  | { ok: true; kind: 'loginCheck'; loggedIn: boolean }
  | { ok: true; kind: 'inject'; draftUrl: string; warnings: string[] }
  | { ok: true; kind: 'readBack'; title: string; bodyChars: number; url: string }
  | {
      ok: false
      code: 'NOT_LOGGED_IN' | 'PAGE_CHANGED' | 'ALREADY_HAS_CONTENT' | 'FILL_FAILED'
      message: string
    }

export type RedbookScriptPayload = RedbookPayload & { timeoutMs?: number }

export async function redbookInjectScript(payload: RedbookScriptPayload): Promise<RedbookResult> {
  const TITLE_SELECTORS = ["input[placeholder*='标题']", "textarea[placeholder*='标题']", 'input.d-text']
  const EDITOR_SELECTORS = [
    ".ql-editor[contenteditable='true']",
    "div[contenteditable='true'][role='textbox']",
    "div[contenteditable='true'][data-placeholder*='正文']",
    "div[contenteditable='true']",
  ]
  const TITLE_LIMIT = 20
  const timeoutMs = payload.timeoutMs ?? 15000
  const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const visible = (el: Element): boolean => {
    if (typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return true
    if (el.hidden || el.closest("[aria-hidden='true']")) return false
    const style = el.ownerDocument.defaultView?.getComputedStyle(el)
    return style?.display !== 'none' && style?.visibility !== 'hidden'
  }
  const firstVisible = <T extends Element>(selectors: string[]): T | null => {
    for (const selector of selectors) {
      const el = document.querySelector<T>(selector)
      if (el && visible(el)) return el
    }
    return null
  }
  const waitFor = async <T extends Element>(selectors: string[]): Promise<T | null> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const el = firstVisible<T>(selectors)
      if (el) return el
      if (Date.now() >= deadline) return null
      await delay(150)
    }
  }
  const loginRequired = (): boolean => {
    if (/\/login(?:[/?#]|$)/i.test(location.href)) return true
    if (firstVisible(EDITOR_SELECTORS)) return false
    const text = document.body.textContent?.replace(/\s+/g, ' ') ?? ''
    return /(?:扫码登录|手机号登录|登录后创作|请先登录)/.test(text)
  }
  const composeBody = (body: string, topics: readonly string[]): string => {
    const tags = topics
      .map((topic) => topic.replace(/^#+|#+$/g, '').trim())
      .filter(Boolean)
      .map((topic) => `#${topic}`)
    return [body.trim(), tags.join(' ')].filter(Boolean).join('\n\n')
  }

  if (loginRequired()) {
    return {
      ok: false,
      code: 'NOT_LOGGED_IN',
      message: '请先登录小红书创作服务平台（发布准备页「打开登录」完成扫码后重试）',
    }
  }
  if (payload.kind === 'loginCheck') return { ok: true, kind: 'loginCheck', loggedIn: true }

  const title = await waitFor<HTMLInputElement | HTMLTextAreaElement>(TITLE_SELECTORS)
  const editor = await waitFor<HTMLElement>(EDITOR_SELECTORS)
  if (!title || !editor) {
    return {
      ok: false,
      code: 'PAGE_CHANGED',
      message: '未找到标题框或正文编辑器：小红书页面结构可能已更新，适配器需更新',
    }
  }

  if (payload.kind === 'readBack') {
    return {
      ok: true,
      kind: 'readBack',
      title: title.value ?? '',
      bodyChars: Array.from(editor.textContent ?? '').length,
      url: location.href,
    }
  }

  // 注入前防覆盖：已有内容且与本次负载不一致 → 拒绝；一致视为幂等重试允许重填。
  const newTitle = Array.from(payload.title.trim()).slice(0, TITLE_LIMIT).join('')
  const newBody = composeBody(payload.body, payload.topics)
  const norm = (value: string) => value.replace(/\s+/g, ' ').trim()
  const existingTitle = title.value ?? ''
  const existingBody = editor.textContent ?? ''
  const prefix = norm(newBody).slice(0, 16)
  const isRefill = existingTitle === newTitle && norm(existingBody).includes(prefix)
  if (!isRefill && (existingTitle.trim() || existingBody.trim())) {
    return {
      ok: false,
      code: 'ALREADY_HAS_CONTENT',
      message: `编辑器已有内容（标题「${existingTitle.slice(0, 12)}」），为防覆盖已停止注入；确认覆盖请先在平台编辑器清空`,
    }
  }

  title.focus()
  title.value = newTitle
  title.dispatchEvent(new Event('input', { bubbles: true }))
  title.dispatchEvent(new Event('change', { bubbles: true }))

  editor.focus()
  const canPaste = typeof ClipboardEvent !== 'undefined' && typeof DataTransfer !== 'undefined'
  if (canPaste) {
    const dt = new DataTransfer()
    dt.setData('text/plain', newBody)
    editor.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt }))
    await delay(150)
  }
  if (!norm(editor.textContent ?? '').includes(prefix)) {
    editor.textContent = newBody
    const InputEventCtor =
      (editor.ownerDocument.defaultView as unknown as { InputEvent?: typeof InputEvent })?.InputEvent ?? InputEvent
    editor.dispatchEvent(new InputEventCtor('input', { bubbles: true, inputType: 'insertText', data: newBody.slice(0, 64) }))
  }
  editor.dispatchEvent(new Event('change', { bubbles: true }))
  editor.dispatchEvent(new Event('blur', { bubbles: true }))
  if (!norm(editor.textContent ?? '').includes(prefix)) {
    return {
      ok: false,
      code: 'FILL_FAILED',
      message: '正文填充未生效（平台编辑器可能拦截注入）：可重试，或复制文稿内容手动粘贴',
    }
  }
  return {
    ok: true,
    kind: 'inject',
    draftUrl: location.href,
    warnings:
      Array.from(payload.title.trim()).length > TITLE_LIMIT ? [`标题超过 ${TITLE_LIMIT} 字，已截断填充`] : [],
  }
}
