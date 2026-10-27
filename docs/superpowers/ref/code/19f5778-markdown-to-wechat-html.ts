/**
 * 【历史资产参考件——P4 公众号发布链】
 * 来源提交：19f5778（feat(m3): 公众号 API 客户端（stable_token 缓存/素材/草稿）、safeStorage 凭证与 md→HTML）
 * 原路径：src/main/publish/markdown-to-wechat-html.ts
 * 提取方式：git show 19f5778:src/main/publish/markdown-to-wechat-html.ts（2026-10-27 提取，内容未改动）
 * 说明：属重置前旧历史的实现，仅供移植参考，不参与当前构建。
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function safeJoin(base: string, rel: string): string {
  const p = path.resolve(base, rel);
  if (p !== path.resolve(base) && !p.startsWith(path.resolve(base) + path.sep)) {
    const err = new Error(`路径越出内容目录: ${rel}`) as Error & { code: string };
    err.code = 'ASSET_OUT_OF_FOLDER'; throw err;
  }
  return p;
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt: string, src: string) => `<img src="${esc(src)}" alt="${esc(alt)}" />`)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, href: string) => `<a href="${esc(href)}">${text}</a>`)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

/** 极小 Markdown → 公众号正文 HTML：标题/段落/加粗/斜体/链接/图片/引用/分隔线；转义在前、不产 JS（draft/add 约束）。 */
export function markdownToWechatHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${inline(esc(para.join(' ')))}</p>`); para = []; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line.trim()) { flush(); continue; }
    const h = line.match(/^(#{1,3})\s+(.*)$/);
    if (h) { flush(); out.push(`<h${h[1]!.length + 1}>${inline(esc(h[2]!))}</h${h[1]!.length + 1}>`); continue; }
    if (/^(---|\*\*\*)\s*$/.test(line)) { flush(); out.push('<hr />'); continue; }
    if (line.startsWith('> ')) { flush(); out.push(`<blockquote>${inline(esc(line.slice(2)))}</blockquote>`); continue; }
    para.push(line.trim());
  }
  flush();
  return out.join('\n');
}

/** 正文内本地图片 → uploadimg URL（draft/add 约束：图片必须来自该接口）。 */
export async function replaceLocalImages(
  html: string, baseDir: string, upload: (bytes: Uint8Array, filename: string) => Promise<string>,
): Promise<string> {
  const srcs = [...html.matchAll(/src="([^"]+)"/g)].map((m) => m[1]!).filter((s) => !/^(https?:)?\/\//.test(s));
  let out = html;
  for (const src of [...new Set(srcs)]) {
    const file = safeJoin(baseDir, src);
    const bytes = new Uint8Array(await readFile(file));
    const url = await upload(bytes, path.basename(file));
    out = out.split(`src="${src}"`).join(`src="${url}"`);
  }
  return out;
}
