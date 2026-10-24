// @vitest-environment jsdom
// （探针事实 #5：pragma 覆盖 node 项目环境；若不生效挪到 tests/renderer/）
import { describe, it, expect } from 'vitest';
import { xiaohongshuInjectScript } from '../../src/main/publish/inject-script-xiaohongshu';

const run = eval(`(${xiaohongshuInjectScript.toString()})`) as typeof xiaohongshuInjectScript; // 探针事实 #4
const EDITOR_HTML = `
  <input placeholder="填写标题会有更多赞哦~" />
  <div class="ql-editor" contenteditable="true" data-placeholder="填写正文"></div>
  <button>发布</button>`;
const LOGIN_HTML = '<div class="login"><p>扫码登录</p><p>手机号登录</p></div>';
const payload = { kind: 'inject', title: '测试标题', body: '这是注入的正文内容', topics: ['话题A'], timeoutMs: 200 } as const;

describe('小红书注入脚本（jsdom fixture 回放）', () => {
  it('登录态页面 → loginCheck 与 inject 都报 NOT_LOGGED_IN', async () => {
    document.body.innerHTML = LOGIN_HTML;
    expect(await run({ kind: 'loginCheck', timeoutMs: 200 })).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' });
    expect(await run(payload)).toMatchObject({ ok: false, code: 'NOT_LOGGED_IN' });
  });
  it('编辑器页注入：标题/正文/话题落位（jsdom 无 DataTransfer 走 textContent 回退——探针事实 #3），话题以 # 追加', async () => {
    document.body.innerHTML = EDITOR_HTML;
    const r = await run(payload);
    expect(r).toMatchObject({ ok: true, kind: 'inject' });
    const input = document.querySelector<HTMLInputElement>("input[placeholder*='标题']")!;
    const editor = document.querySelector<HTMLElement>('.ql-editor')!;
    expect(input.value).toBe('测试标题');
    expect(editor.textContent).toContain('这是注入的正文内容');
    expect(editor.textContent).toContain('#话题A');
    expect((r as { draftUrl: string }).draftUrl).toBe(location.href);
  });
  it('标题超 20 字自动截断并带 warning', async () => {
    document.body.innerHTML = EDITOR_HTML;
    const r = await run({ ...payload, title: '一二三四五六七八九十一二三四五六七八九十一' });
    expect(document.querySelector<HTMLInputElement>('input')!.value).toBe('一二三四五六七八九十一二三四五六七八九十');
    expect((r as { warnings: string[] }).warnings.join()).toContain('20');
  });
  it('防覆盖：已有不同内容拒绝（ALREADY_HAS_CONTENT）；同内容幂等重填允许', async () => {
    document.body.innerHTML = EDITOR_HTML;
    document.querySelector<HTMLInputElement>('input')!.value = '别人的标题';
    const r = await run(payload);
    expect(r).toMatchObject({ ok: false, code: 'ALREADY_HAS_CONTENT' });
    // 幂等：先注入成功，再注入同一负载 → 允许重填
    document.body.innerHTML = EDITOR_HTML;
    await run(payload);
    const again = await run(payload);
    expect(again).toMatchObject({ ok: true });
  });
  it('页面无编辑器元素 → PAGE_CHANGED（绝不静默）', async () => {
    document.body.innerHTML = '<div>空页面</div>';
    expect(await run(payload)).toMatchObject({ ok: false, code: 'PAGE_CHANGED' });
  });
  it('readBack 回读标题与正文字数', async () => {
    document.body.innerHTML = EDITOR_HTML;
    await run(payload);
    const r = await run({ kind: 'readBack', timeoutMs: 200 });
    expect(r).toMatchObject({ ok: true, kind: 'readBack', title: '测试标题' });
    expect((r as { bodyChars: number }).bodyChars).toBeGreaterThan(0);
  });
});
