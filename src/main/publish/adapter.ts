import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PlatformKey, PublishFailureCategory, VariantDoc } from '../../shared/types';
import { PLATFORM_RULES, type PlatformRules } from '../../shared/platform-rules';
import { xiaohongshuInjectScript, type XhsPayload, type XhsResult } from './inject-script-xiaohongshu';
import { markdownToWechatHtml, replaceLocalImages, safeJoin } from './markdown-to-wechat-html';
import { WechatApiError, WechatNetworkError, type WechatMpClient } from './wechat-mp';

/** 页面驱动：PlatformSession（electron）实现；测试替身实现同接口。 */
export type PageDriver = {
  evaluate<T>(fnSource: string, payload: unknown): Promise<T>;
  currentUrl(): string;
};
export type LoginCheckResult = { loggedIn: boolean; message?: string };
export type InjectInput = { doc: VariantDoc; variantPath: string; contentFolder: string };
export type InjectResult =
  | { ok: true; draftUrl?: string; mediaId?: string; warnings: string[] }
  | { ok: false; code: string; message: string };
export type ReadBackResult = { ok: true; title: string; bodyChars: number; url?: string } | { ok: false; message: string };

/** spec §6 适配器接口：loginCheck / injectDraft / readBackStatus / rules（platformRules）。 */
export interface PlatformAdapter {
  readonly key: PlatformKey;
  readonly rules: PlatformRules;
  readonly usesSession: boolean; // dom=true（页面驱动）；api=false（无页面——PublishService 跳过 runtime.open，传空驱动 noPageDriver）
  loginCheck(d: PageDriver): Promise<LoginCheckResult>;
  injectDraft(d: PageDriver, input: InjectInput): Promise<InjectResult>;
  readBackStatus(d: PageDriver): Promise<ReadBackResult>;
}

export function classifyFailure(code: string): PublishFailureCategory {
  switch (code) {
    case 'NOT_LOGGED_IN': return 'not_logged_in';
    case 'PAGE_CHANGED': case 'FILL_FAILED': return 'page_changed';
    case 'ALREADY_HAS_CONTENT': return 'already_has_content';
    case 'NETWORK': case 'TIMEOUT': return 'network';
    case 'WECHAT_API': return 'api_error';
    default: return 'unknown';
  }
}

function msg(err: unknown): string { return err instanceof Error ? err.message : String(err); }

export const xiaohongshuAdapter: PlatformAdapter = {
  key: 'xiaohongshu',
  rules: PLATFORM_RULES.xiaohongshu,
  usesSession: true,
  async loginCheck(d) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), { kind: 'loginCheck' } satisfies XhsPayload);
    return r.ok ? { loggedIn: true } : { loggedIn: false, message: r.message };
  },
  async injectDraft(d, input) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), {
      kind: 'inject', title: input.doc.title, body: input.doc.body, topics: input.doc.topics,
    } satisfies XhsPayload);
    return r.ok && r.kind === 'inject'
      ? { ok: true, draftUrl: r.draftUrl, warnings: r.warnings }
      : r.ok ? { ok: false, code: 'PAGE_CHANGED', message: '意外结果' } : { ok: false, code: r.code, message: r.message };
  },
  async readBackStatus(d) {
    const r = await d.evaluate<XhsResult>(xiaohongshuInjectScript.toString(), { kind: 'readBack' } satisfies XhsPayload);
    return r.ok && r.kind === 'readBack'
      ? { ok: true, title: r.title, bodyChars: r.bodyChars, url: r.url }
      : { ok: false, message: r.ok ? '意外结果' : r.message };
  },
};

/** 公众号文章（API 模式）：封面→永久素材；正文 md→HTML 且本地图片全部经 uploadimg；创建草稿停在草稿态。 */
export function createWechatArticleAdapter(deps: { client(): WechatMpClient | null }): PlatformAdapter {
  return {
    key: 'wechat-article',
    rules: PLATFORM_RULES['wechat-article'],
    usesSession: false,
    async loginCheck() {
      const c = deps.client();
      if (!c) return { loggedIn: false, message: '未配置公众号 AppID/AppSecret（发布中心 →「公众号配置」）' };
      try { await c.getAccessToken(); return { loggedIn: true }; }
      catch (err) {
        const hint = err instanceof WechatApiError && (err.errcode === 40125 || err.errcode === 40013)
          ? '（检查 AppSecret 是否正确、本机出口 IP 是否已加入公众号后台 IP 白名单）' : '';
        return { loggedIn: false, message: `${msg(err)}${hint}` };
      }
    },
    async injectDraft(_d, input) {
      const c = deps.client();
      if (!c) return { ok: false, code: 'WECHAT_API', message: '未配置公众号凭证' };
      try {
        const coverPath = safeJoin(input.contentFolder, input.doc.cover ?? '');
        const coverBytes = new Uint8Array(await readFile(coverPath));
        const { mediaId: thumbMediaId } = await c.uploadImageMaterial(coverBytes, path.basename(coverPath));
        let html = markdownToWechatHtml(input.doc.body);
        html = await replaceLocalImages(html, input.contentFolder, (bytes, name) => c.uploadContentImage(bytes, name));
        const mediaId = await c.createDraft({
          title: input.doc.title, digest: input.doc.digest || undefined, content: html, thumbMediaId,
        });
        return { ok: true, mediaId, warnings: [] };
      } catch (err) {
        if (err instanceof WechatNetworkError) return { ok: false, code: 'NETWORK', message: msg(err) };
        if (err instanceof WechatApiError) return { ok: false, code: 'WECHAT_API', message: msg(err) };
        if ((err as { code?: string })?.code === 'ASSET_OUT_OF_FOLDER') return { ok: false, code: 'WECHAT_API', message: msg(err) };
        return { ok: false, code: 'UNKNOWN', message: msg(err) };
      }
    },
    async readBackStatus() { return { ok: true, title: '', bodyChars: 0 }; }, // API 模式无页面回读；草稿以 media_id 为准（后台人工可见）
  };
}
