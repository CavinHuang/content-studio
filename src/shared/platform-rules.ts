import type { PlatformKey, VariantDoc, VariantValidation } from './types';

export type PlatformRules = {
  key: PlatformKey;
  label: string;
  mode: 'dom' | 'api'; // dom=内嵌浏览器注入；api=官方 API（公众号文章）
  editorUrl?: string;  // dom 平台默认真实编辑器 URL（可被设置/env 覆盖）
  notes: string[];     // 写作硬规则文案（技能 SKILL.md 与 UI 共用口径）
  validate(doc: VariantDoc): VariantValidation;
};

export function platformKeys(): PlatformKey[] { return ['xiaohongshu', 'x', 'jike', 'wechat-article']; }
export function isPlatformKey(v: string): v is PlatformKey { return (platformKeys() as string[]).includes(v); }

const chars = (s: string): number => Array.from(s.replace(/\s+/g, '')).length;

/** X 加权计数（spec §5）：链接按 t.co 缩短长度计 23，中文/全角每字计 2，其余计 1。 */
export function xWeightedLength(text: string): number {
  let weight = 0;
  const rest = text.replace(/https?:\/\/\S+/g, () => { weight += 23; return ''; });
  for (const ch of rest) weight += /[\u2E80-\u9FFF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return weight;
}

function make(key: PlatformKey, label: string, mode: 'dom' | 'api', notes: string[], validate: PlatformRules['validate'], editorUrl?: string): PlatformRules {
  return { key, label, mode, notes, validate, ...(editorUrl ? { editorUrl } : {}) };
}

const xiaohongshu = make('xiaohongshu', '小红书', 'dom', [
  '正文 600–900 字（硬上限 1000 字）', '标题不超过 20 字', '话题可选，多个用顿号分隔，注入时以 #话题 追加到正文末尾',
], (doc) => {
  const errors: string[] = []; const warnings: string[] = [];
  const title = Array.from(doc.title.trim());
  if (title.length === 0) errors.push('标题不能为空');
  if (title.length > 20) errors.push(`标题 ${title.length} 字，超过小红书 20 字上限`);
  const n = chars(doc.body);
  if (n > 1000) errors.push(`正文 ${n} 字，超过小红书 1000 字硬上限`);
  else if (n > 900) warnings.push(`正文 ${n} 字，超过 900 字建议区间`);
  else if (n < 600) warnings.push(`正文 ${n} 字，低于 600 字建议区间`);
  if (doc.topics.some((t) => !t.trim())) errors.push('话题不能为空白');
  return { ok: errors.length === 0, errors, warnings };
}, 'https://creator.xiaohongshu.com/publish/publish');

const x = make('x', 'X（Twitter）', 'dom', [
  '动态无标题', '加权计数 ≤280：中文每字计 2、链接按缩短长度计 23',
], (doc) => {
  const errors: string[] = [];
  if (doc.title.trim()) errors.push('X 动态没有标题，请把内容放进正文');
  const w = xWeightedLength(doc.body);
  if (w > 280) errors.push(`X 加权计数 ${w}，超过 280`);
  return { ok: errors.length === 0, errors, warnings: [] };
});

const jike = make('jike', '即刻', 'dom', [
  '动态需至少一个话题（发布时在平台选择话题/圈子）', '正文短评式，无本地字数硬上限',
], (doc) => {
  const errors: string[] = [];
  if (doc.topics.map((t) => t.trim()).filter(Boolean).length === 0) errors.push('即刻动态需至少一个话题');
  return { ok: errors.length === 0, errors, warnings: [] };
});

const wechatArticle = make('wechat-article', '公众号文章', 'api', [
  '标题必填，不超过 32 字', '摘要可选，不超过 120 字（留空平台取正文前 54 字）',
  '封面必填（内容库内图片相对路径，如 assets/cover.png）', '正文少于 2 万字符；图片用 Markdown 引用内容库内路径',
], (doc) => {
  const errors: string[] = [];
  const title = Array.from(doc.title.trim());
  if (title.length === 0) errors.push('标题不能为空');
  if (title.length > 32) errors.push(`标题 ${title.length} 字，超过公众号 32 字上限`);
  if (Array.from((doc.digest ?? '').trim()).length > 120) errors.push('摘要超过 120 字上限');
  if (!doc.cover?.trim()) errors.push('需要封面图（公众号草稿必填 thumb 封面素材）');
  if (chars(doc.body) === 0) errors.push('正文不能为空');
  if (doc.body.length >= 20000) errors.push(`正文 ${doc.body.length} 字符，达到公众号 2 万字符上限`);
  return { ok: errors.length === 0, errors, warnings: [] };
});

export const PLATFORM_RULES: Record<PlatformKey, PlatformRules> = {
  xiaohongshu, x, jike, 'wechat-article': wechatArticle,
};

export function validateVariant(platform: PlatformKey, doc: VariantDoc): VariantValidation {
  return PLATFORM_RULES[platform].validate({ ...doc, platform });
}
