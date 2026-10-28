import { expect, test } from 'vitest'
import {
  REDBOOK_DEFAULT_ALLOWED_HOSTS,
  REDBOOK_DEFAULT_EDITOR_URL,
  checkEditorUrl,
  normalizeUserAgent,
  resolveRedbookEditorConfig,
} from '../../packages/desktop/src/main/publish/redbook/policy'

test('checkEditorUrl：官方域名放行；非白名单/不合法地址拒绝', () => {
  expect(checkEditorUrl(REDBOOK_DEFAULT_EDITOR_URL, REDBOOK_DEFAULT_ALLOWED_HOSTS)).toMatchObject({
    ok: true,
    host: 'creator.xiaohongshu.com',
  })
  expect(
    checkEditorUrl('https://evil.example.com/publish', REDBOOK_DEFAULT_ALLOWED_HOSTS),
  ).toMatchObject({ ok: false, code: 'EDITOR_URL_BLOCKED' })
  expect(checkEditorUrl('not a url', REDBOOK_DEFAULT_ALLOWED_HOSTS)).toMatchObject({
    ok: false,
    code: 'EDITOR_URL_INVALID',
  })
  // file:// 等非 http(s) 协议一律视为不合法
  expect(checkEditorUrl('file:///C:/editor.html', REDBOOK_DEFAULT_ALLOWED_HOSTS)).toMatchObject({
    ok: false,
    code: 'EDITOR_URL_INVALID',
  })
})

test('resolveRedbookEditorConfig：缺省官方地址；显式覆盖时 hostname 追加白名单；坏覆盖回退官方', () => {
  expect(resolveRedbookEditorConfig()).toEqual({
    editorUrl: REDBOOK_DEFAULT_EDITOR_URL,
    allowedHosts: [...REDBOOK_DEFAULT_ALLOWED_HOSTS],
  })
  const overridden = resolveRedbookEditorConfig('http://127.0.0.1:8930/editor')
  expect(overridden.editorUrl).toBe('http://127.0.0.1:8930/editor')
  expect(overridden.allowedHosts).toContain('127.0.0.1')
  expect(checkEditorUrl(overridden.editorUrl, overridden.allowedHosts)).toMatchObject({ ok: true })
  expect(resolveRedbookEditorConfig('::::')).toEqual({
    editorUrl: REDBOOK_DEFAULT_EDITOR_URL,
    allowedHosts: [...REDBOOK_DEFAULT_ALLOWED_HOSTS],
  })
})

test('normalizeUserAgent：剥离 Electron 与应用名 token，其余保留', () => {
  const ua =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Electron/45.0.0 Content Studio/0.1.0'
  expect(normalizeUserAgent(ua, 'Content Studio')).toBe(
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
  )
  // 应用名含正则元字符时也不误伤
  expect(normalizeUserAgent('UA App/1.0 Electron/1.2.3', 'App+X')).toBe('UA App/1.0')
})
