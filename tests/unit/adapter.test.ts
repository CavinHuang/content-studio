import { describe, it, expect } from 'vitest';
import { xiaohongshuAdapter, createWechatArticleAdapter, classifyFailure } from '../../src/main/publish/adapter';
import type { PageDriver } from '../../src/main/publish/adapter';
import { xiaohongshuInjectScript } from '../../src/main/publish/inject-script-xiaohongshu';
import { PLATFORM_RULES } from '../../src/shared/platform-rules';

function driverWith(result: unknown): PageDriver {
  return {
    evaluate: async (src, payload) => {
      expect(src).toBe(xiaohongshuInjectScript.toString()); // 注入脚本源原样下发
      expect(payload).toBeTruthy();
      return result as never;
    },
    currentUrl: () => 'https://creator.xiaohongshu.com/publish/publish',
  };
}

describe('适配器层', () => {
  it('小红书适配器：loginCheck/inject/readBack 结果映射与 rules 引用', async () => {
    expect(xiaohongshuAdapter.rules).toBe(PLATFORM_RULES.xiaohongshu);
    expect(xiaohongshuAdapter.usesSession).toBe(true);
    expect(await xiaohongshuAdapter.loginCheck(driverWith({ ok: true, kind: 'loginCheck', loggedIn: true }))).toEqual({ loggedIn: true });
    expect(await xiaohongshuAdapter.loginCheck(driverWith({ ok: false, code: 'NOT_LOGGED_IN', message: 'x' }))).toEqual({ loggedIn: false, message: 'x' });
    const r = await xiaohongshuAdapter.injectDraft(driverWith({ ok: true, kind: 'inject', draftUrl: 'https://u', warnings: [] }), {
      doc: { platform: 'xiaohongshu', title: 't', topics: [], body: 'b' }, variantPath: 'p/platforms/xiaohongshu.md', contentFolder: 'C:/c',
    });
    expect(r).toEqual({ ok: true, draftUrl: 'https://u', warnings: [] });
    const bad = await xiaohongshuAdapter.injectDraft(driverWith({ ok: false, code: 'ALREADY_HAS_CONTENT', message: 'm' }), {
      doc: { platform: 'xiaohongshu', title: 't', topics: [], body: 'b' }, variantPath: 'p', contentFolder: 'C:/c',
    });
    expect(bad).toMatchObject({ ok: false, code: 'ALREADY_HAS_CONTENT' });
  });
  it('公众号文章适配器：未配置凭证时 loginCheck 引导配置；注入返回 WECHAT_API', async () => {
    const a = createWechatArticleAdapter({ client: () => null });
    expect(a.rules).toBe(PLATFORM_RULES['wechat-article']);
    expect(a.usesSession).toBe(false);
    expect(await a.loginCheck(null as never)).toMatchObject({ loggedIn: false });
    const r = await a.injectDraft(null as never, { doc: { platform: 'wechat-article', title: 't', topics: [], body: 'b', cover: 'c.png' }, variantPath: 'p', contentFolder: 'C:/c' });
    expect(r).toMatchObject({ ok: false, code: 'WECHAT_API' });
  });
  it('classifyFailure：三分类+扩展类映射', () => {
    expect(classifyFailure('NOT_LOGGED_IN')).toBe('not_logged_in');
    expect(classifyFailure('PAGE_CHANGED')).toBe('page_changed');
    expect(classifyFailure('FILL_FAILED')).toBe('page_changed');
    expect(classifyFailure('NETWORK')).toBe('network');
    expect(classifyFailure('TIMEOUT')).toBe('network');
    expect(classifyFailure('ALREADY_HAS_CONTENT')).toBe('already_has_content');
    expect(classifyFailure('WECHAT_API')).toBe('api_error');
    expect(classifyFailure('WHATEVER')).toBe('unknown');
  });
});
