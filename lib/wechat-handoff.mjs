/** Doocs/md is a standalone editor, not a React library or a documented two-way SDK.
 * This module produces an explicit Markdown handoff; no hidden cross-origin state sync.
 */
export const HANDOFF_MAX_LENGTH = 150_000;
export function markdownFromDocument(title, paragraphs = []) {
  const heading = String(title || '未命名文章').trim().replace(/[\r\n]+/g, ' ');
  return [`# ${heading}`, ...paragraphs.map(p => String(p?.text || '').trim()).filter(Boolean)].join('\n\n') + '\n';
}
export function validateHandoffMarkdown(markdown) {
  if (typeof markdown !== 'string') throw Object.assign(new Error('Markdown must be text'), {status:400});
  const normalized = markdown.replace(/\r\n?/g, '\n').replace(/\0/g, '');
  if (normalized.trim().length < 5 || normalized.length > HANDOFF_MAX_LENGTH) throw Object.assign(new Error('Markdown size must be 5-150000 characters'), {status:400});
  return normalized;
}
export function suggestFilename(title, channel, revision) {
  const safe = String(title || 'article').normalize('NFKC').replace(/[\\/<>:"|?*\x00-\x1f]/g, '-').trim().slice(0, 55) || 'article';
  return `${safe}-${channel}-layout-v${revision}.md`;
}
