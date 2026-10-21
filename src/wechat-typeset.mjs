// 微信公众号排版引擎：主题化 Markdown → 平台兼容 HTML。
// 架构借鉴 wewrite（MIT，内联主题 + 平台兼容修复清单）与 ZJU-REAL/Easel
// gzh-design（AGPL，仅借鉴「主题组件库 + 确定性校验」的思路，未复制任何代码）。
// 全部实现为本仓库原创：主题是语义 token 集，转换是纯函数，可离线单测。
import { Marked } from "marked";

// 主题只定义语义 token：每个元素一段内联 CSS。公众号编辑器会剥离 <style>
// 与 class，因此所有样式必须逐元素内联。
export const WECHAT_THEMES = [
  {
    id: "ink-classic", name: "墨版经典", description: "深灰正文、衬线标题、引用竖线的杂志式排版。",
    tokens: {
      root: "font-size:15px;line-height:1.9;color:#2b2b2b;letter-spacing:.3px;font-family:-apple-system-font,BlinkMacSystemFont,'Helvetica Neue','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif;padding:0 8px;",
      h1: "font-size:20px;font-weight:700;color:#1a1a1a;margin:28px 0 16px;letter-spacing:.5px;",
      h2: "font-size:17px;font-weight:700;color:#1a1a1a;margin:24px 0 12px;border-left:4px solid #2b2b2b;padding-left:10px;",
      h3: "font-size:15px;font-weight:700;color:#333;margin:20px 0 10px;",
      p: "margin:0 0 16px;text-align:justify;",
      blockquote: "margin:16px 0;padding:10px 14px;background:#f7f7f7;border-left:3px solid #999;color:#555;font-size:14px;",
      li: "margin:0 0 8px;",
      strong: "font-weight:700;color:#1a1a1a;",
      code: "font-size:13px;background:#f2f2f2;padding:1px 5px;border-radius:3px;",
      pre: "font-size:13px;background:#f6f8fa;padding:12px;overflow-x:auto;border-radius:4px;line-height:1.6;",
      hr: "border:none;border-top:1px solid #ddd;margin:28px 0;",
      img: "max-width:100%;border-radius:4px;display:block;margin:16px auto;",
      footnote: "font-size:12px;color:#888;line-height:1.7;",
      footnotesTitle: "font-size:13px;font-weight:700;color:#888;margin:24px 0 8px;",
    },
  },
  {
    id: "paper-warm", name: "纸面暖调", description: "米白卡片底、暖棕强调，适合生活与随笔。",
    tokens: {
      root: "font-size:15px;line-height:2;color:#3d3229;letter-spacing:.4px;font-family:Georgia,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',serif;padding:0 8px;",
      h1: "font-size:20px;font-weight:700;color:#4a3524;margin:28px 0 16px;",
      h2: "font-size:17px;font-weight:700;color:#6b4f2e;margin:24px 0 12px;padding-bottom:6px;border-bottom:1px dashed #d8c8ae;",
      h3: "font-size:15px;font-weight:700;color:#7a5c39;margin:20px 0 10px;",
      p: "margin:0 0 16px;text-align:justify;",
      blockquote: "margin:16px 0;padding:12px 14px;background:#faf5ec;border-left:3px solid #c9a86a;color:#5c4a33;font-size:14px;",
      li: "margin:0 0 8px;",
      strong: "font-weight:700;color:#8a5a2b;",
      code: "font-size:13px;background:#f3ead9;padding:1px 5px;border-radius:3px;",
      pre: "font-size:13px;background:#f7f1e5;padding:12px;overflow-x:auto;border-radius:4px;line-height:1.6;",
      hr: "border:none;border-top:1px dashed #d8c8ae;margin:28px 0;",
      img: "max-width:100%;border-radius:6px;display:block;margin:16px auto;",
      footnote: "font-size:12px;color:#9a8670;line-height:1.7;",
      footnotesTitle: "font-size:13px;font-weight:700;color:#9a8670;margin:24px 0 8px;",
    },
  },
  {
    id: "cool-tech", name: "冷静科技", description: "蓝灰强调、等宽标题点缀，适合技术与产品分析。",
    tokens: {
      root: "font-size:15px;line-height:1.85;color:#26313d;letter-spacing:.2px;font-family:-apple-system-font,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;padding:0 8px;",
      h1: "font-size:20px;font-weight:700;color:#16222e;margin:28px 0 16px;",
      h2: "font-size:17px;font-weight:700;color:#1f3a56;margin:24px 0 12px;border-left:4px solid #3d6b9e;padding-left:10px;background:#f0f5fa;padding-top:6px;padding-bottom:6px;",
      h3: "font-size:15px;font-weight:700;color:#2d5379;margin:20px 0 10px;",
      p: "margin:0 0 16px;text-align:justify;",
      blockquote: "margin:16px 0;padding:10px 14px;background:#f0f5fa;border-left:3px solid #3d6b9e;color:#41546b;font-size:14px;",
      li: "margin:0 0 8px;",
      strong: "font-weight:700;color:#1f3a56;",
      code: "font-size:13px;background:#eef2f7;padding:1px 5px;border-radius:3px;color:#1f3a56;",
      pre: "font-size:13px;background:#0f1722;color:#dbe7f5;padding:12px;overflow-x:auto;border-radius:4px;line-height:1.6;",
      hr: "border:none;border-top:1px solid #d4dde7;margin:28px 0;",
      img: "max-width:100%;border-radius:4px;display:block;margin:16px auto;",
      footnote: "font-size:12px;color:#7d8ea1;line-height:1.7;",
      footnotesTitle: "font-size:13px;font-weight:700;color:#7d8ea1;margin:24px 0 8px;",
    },
  },
];

export function wechatThemeById(id) {
  return WECHAT_THEMES.find((t) => t.id === id) || null;
}

const CJK = /([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef])([A-Za-z0-9@&₩$])/g;
const LATIN = /([A-Za-z0-9%)\]])([\u4e00-\u9fff])/g;

// 仅处理标签外的文本段；code/pre 内的空格是代码语义，原样保留。
export function cjkSpacing(html) {
  const segments = html.split(/(<[^>]+>)/);
  let inCode = 0;
  return segments
    .map((seg, i) => {
      if (i % 2 === 1) {
        if (/^<(pre|code)\b/i.test(seg)) inCode += 1;
        else if (/^<\/(pre|code)>/i.test(seg)) inCode = Math.max(0, inCode - 1);
        return seg;
      }
      if (inCode > 0) return seg;
      return seg.replace(CJK, "$1 $2").replace(LATIN, "$1 $2");
    })
    .join("");
}

// 微信正文里尾随标点在 strong/em 内会被原样加粗，观感差：把句尾句读移出标签。
export function movePunctuationOutOfEmphasis(html) {
  return html.replace(/<(strong|b|em|i)>([^<]*?)([。，、；：？！…—])<\/\1>/g, "<$1>$2</$1>$3");
}

// 外链转脚注：正文里只留「文本 + 上标序号」，链接集中到文末脚注节。
export function externalLinksToFootnotes(html) {
  const notes = [];
  const body = html.replace(/<a\s+(?:[^>]*?\s+)?href="(https?:\/\/[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi,
    (match, href, text) => {
      const plain = text.replace(/<[^>]+>/g, "").trim();
      notes.push({ href, text: plain || href });
      return `${text}<sup>[${notes.length}]</sup>`;
    });
  if (notes.length === 0) return { html: body, notes };
  const section =
    `<section class="wechat-footnotes"><p style="__FOOTNOTES_TITLE__">参考链接</p>` +
    notes.map((n, i) => `<p style="__FOOTNOTE__">${i + 1}. ${escapeHtml(n.text)}：${escapeHtml(n.href)}</p>`).join("") +
    `</section>`;
  return { html: body + section, notes };
}

function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function applyTheme(html, tokens) {
  let out = html;
  for (const [tag, css] of Object.entries(tokens)) {
    if (tag === "root" || tag === "footnote" || tag === "footnotesTitle") continue;
    const re = new RegExp(`<${tag}(|\\s[^>]*)>`, "gi");
    out = out.replace(re, `<${tag}$1 style="${css}">`);
  }
  const root = `<section class="wechat-article" style="${tokens.root}">`;
  return root + out + "</section>";
}

function placeFootnoteStyles(html, tokens) {
  return html
    .replace(/__FOOTNOTES_TITLE__/g, tokens.footnotesTitle)
    .replace(/__FOOTNOTE__/g, tokens.footnote);
}

// 发布前校验：会被公众号过滤或不该出现的内容。返回 {ok, errors}。
export function validateWechatHtml(html) {
  const errors = [];
  if (/<script\b/i.test(html)) errors.push("包含 <script>，公众号会整段过滤");
  if (/<style\b/i.test(html)) errors.push("包含 <style> 标签，样式必须内联");
  if (/<iframe\b/i.test(html)) errors.push("包含 <iframe>，公众号不支持");
  const externalImg = /<img\b[^>]*src="(https?:\/\/[^"]*)"/gi.exec(html);
  if (externalImg) errors.push("存在外链图片 " + externalImg[1] + "：公众号外链图片会被屏蔽，请先经素材映射为本地/微信图地址");
  return { ok: errors.length === 0, errors };
}

// 主入口：Markdown → 微信兼容 HTML。
export function renderWechatHtml(markdown, { themeId = "ink-classic" } = {}) {
  const theme = wechatThemeById(themeId) || WECHAT_THEMES[0];
  const marked = new Marked({ gfm: true, breaks: true });
  let html = marked.parse(markdown ?? "");
  html = movePunctuationOutOfEmphasis(html);
  const footnoted = externalLinksToFootnotes(html);
  html = cjkSpacing(footnoted.html);
  html = applyTheme(html, theme.tokens);
  html = placeFootnoteStyles(html, theme.tokens);
  const document = "<!doctype html><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" + html;
  return { html: document, themeId: theme.id, themeName: theme.name, footnotes: footnoted.notes, validation: validateWechatHtml(document) };
}
