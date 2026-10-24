import { mkdir, readdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';
import type { DraftSummary } from '../shared/types';
import { writeBody } from './content-library';

/** 内容 id 格式 = content-library uniqueId 的生成格式（c_YYYYMMDD_<hex4>）。
 *  drafts 的 contentId 多来自渲染端 IPC 直传，先过格式关再拼路径——
 *  挡目录穿越（../、绝对路径、分隔符），与 name 侧 assertDraftName 同为防纵深（spec §3）。 */
const CONTENT_ID_RE = /^c_\d{8}_[0-9a-f]{4}$/;

export function draftsDir(root: string, contentId: string): string {
  if (!CONTENT_ID_RE.test(contentId)) {
    const err = new Error(`非法内容 id: ${contentId}`) as Error & { code: string };
    err.code = 'DRAFT_BAD_CONTENT_ID';
    throw err;
  }
  return path.join(root, '.studio', 'drafts', contentId);
}

function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function saveDraft(
  root: string, contentId: string, input: { markdown: string; note?: string },
): Promise<DraftSummary> {
  const dir = draftsDir(root, contentId);
  await mkdir(dir, { recursive: true });
  const created = new Date().toISOString();
  const name = `draft-${stamp()}-${randomBytes(2).toString('hex')}.md`;
  const file = path.join(dir, name);
  // 与 content-library 同策略：唯一临时名 + rename（并发写互不覆盖）
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  const front = matter.stringify('', { created, note: input.note ?? '' }).slice(0, -1); // `---\n<yaml>\n---\n`
  await writeFile(tmp, front + input.markdown, 'utf8');
  await rename(tmp, file);
  return { name, created, note: input.note ?? '', bytes: Buffer.byteLength(input.markdown, 'utf8') };
}

export async function listDrafts(root: string, contentId: string): Promise<DraftSummary[]> {
  const dir = draftsDir(root, contentId); // 校验在前：非法 id 直接抛，不落入下方"目录不存在"兜底
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); }
  catch { return []; } // 目录不存在=无草稿
  const out: DraftSummary[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith('.md')) continue;
    try {
      const raw = await readFile(path.join(dir, e.name), 'utf8');
      const { data, content } = matter(raw);
      out.push({
        name: e.name,
        created: String(data.created ?? ''),
        note: String(data.note ?? ''),
        bytes: Buffer.byteLength(content, 'utf8'),
      });
    } catch { /* 单文件损坏跳过，不阻塞列表 */ }
  }
  out.sort((a, b) => b.created.localeCompare(a.created));
  return out;
}

function assertDraftName(name: string): void {
  if (path.basename(name) !== name || name.includes('..')) {
    const err = new Error(`非法草稿名: ${name}`) as Error & { code: string };
    err.code = 'DRAFT_BAD_NAME';
    throw err;
  }
}

export async function readDraft(root: string, contentId: string, name: string): Promise<string> {
  assertDraftName(name);
  const raw = await readFile(path.join(draftsDir(root, contentId), name), 'utf8');
  return matter(raw).content;
}

/** 人确认后的落盘：草稿正文 → 既有原子 writeBody（frontmatter 保留）→ 消费草稿。 */
export async function applyDraft(root: string, contentId: string, name: string): Promise<{ savedAt: string }> {
  const body = await readDraft(root, contentId, name);
  const r = await writeBody(root, contentId, body);
  await unlink(path.join(draftsDir(root, contentId), name)).catch(() => {});
  return r;
}

export async function discardDraft(root: string, contentId: string, name: string): Promise<void> {
  assertDraftName(name);
  await unlink(path.join(draftsDir(root, contentId), name));
}
