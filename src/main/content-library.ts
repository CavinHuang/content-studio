import { readdir, readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';
import type { Content, ContentMeta, LibraryScan, Stage } from '../shared/types';
import { STAGES } from '../shared/types';

export async function listContents(root: string): Promise<LibraryScan> {
  const entries = await readdir(root, { withFileTypes: true });
  const items: ContentMeta[] = [];
  const warnings: string[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith('.')) { warnings.push(`跳过隐藏目录 ${e.name}`); continue; }
    const mdPath = path.join(root, e.name, 'content.md');
    try {
      const raw = await readFile(mdPath, 'utf8');
      const { data } = matter(raw);
      const stage = STAGES.includes(data.stage as Stage) ? (data.stage as Stage) : 'idea';
      items.push({
        id: String(data.id ?? ''),
        title: String(data.title ?? e.name),
        stage,
        tags: Array.isArray(data.tags) ? data.tags.map(String) : [],
        created: String(data.created ?? ''),
        media: data.media === 'video' ? 'video' : 'article',
        folder: e.name,
      });
    } catch (err) {
      warnings.push(`目录 ${e.name} 无 content.md 或解析失败，已跳过`);
    }
  }
  items.sort((a, b) => b.created.localeCompare(a.created));
  return { items, warnings };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function sanitize(title: string): string {
  const s = title.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '');
  return (s || '未命名').slice(0, 50);
}
async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}
async function uniqueFolder(root: string, base: string): Promise<string> {
  let name = base;
  for (let i = 2; await exists(path.join(root, name)); i++) name = `${base}-${i}`;
  return name;
}

/**
 * 标题写入 frontmatter 时的标量形式：作为 YAML 纯标量可无损往返（读取端 gray-matter
 * 解析回原字符串）则裸写以保持人可读；含歧义字符（"a: b"、"2026-10-24" 等）则
 * 退回 JSON 双引号形式，保证任何标题都能安全往返。
 */
function frontScalar(value: string): string {
  try {
    const round = matter(`---\ntitle: ${value}\n---\n`);
    if (round.data.title === value) return value;
  } catch { /* 解析失败落入引号分支 */ }
  return JSON.stringify(value);
}

export async function createContent(root: string, input: { title: string; tags?: string[] }): Promise<ContentMeta> {
  const d = today();
  const id = `c_${d.replaceAll('-', '')}_${randomBytes(2).toString('hex')}`;
  const folder = await uniqueFolder(root, `${d}-${sanitize(input.title)}`);
  const dir = path.join(root, folder);
  await mkdir(path.join(dir, 'assets'), { recursive: true });
  const front = [
    `id: ${id}`, `title: ${frontScalar(input.title)}`, 'stage: idea',
    input.tags?.length ? `tags: [${input.tags.map((t) => JSON.stringify(t)).join(', ')}]` : 'tags: []',
    `created: "${d}"`, 'media: article',
  ].join('\n');
  await writeFile(path.join(dir, 'content.md'), `---\n${front}\n---\n\n`, 'utf8');
  return { id, title: input.title, stage: 'idea', tags: input.tags ?? [], created: d, media: 'article', folder };
}

export async function readContent(root: string, id: string): Promise<Content> {
  const meta = await mustFind(root, id);
  const raw = await readFile(path.join(root, meta.folder, 'content.md'), 'utf8');
  const parsed = matter(raw);
  return { ...meta, body: parsed.content.trimStart() };
}

export async function writeBody(root: string, id: string, body: string): Promise<{ savedAt: string }> {
  const meta = await mustFind(root, id);
  const file = path.join(root, meta.folder, 'content.md');
  const raw = await readFile(file, 'utf8');
  const { data } = matter(raw);
  const tmp = `${file}.tmp`;
  await writeFile(tmp, stringifyDoc(body, data), 'utf8');
  await rename(tmp, file);
  return { savedAt: new Date().toISOString() };
}

export async function updateMeta(
  root: string, id: string,
  patch: { stage?: Stage; tags?: string[]; title?: string },
): Promise<ContentMeta> {
  const meta = await mustFind(root, id);
  const file = path.join(root, meta.folder, 'content.md');
  const raw = await readFile(file, 'utf8');
  const { data, content } = matter(raw);
  const next = { ...data, ...(patch.stage ? { stage: patch.stage } : {}),
    ...(patch.tags ? { tags: patch.tags } : {}), ...(patch.title ? { title: patch.title } : {}) };
  const tmp = `${file}.tmp`;
  await writeFile(tmp, stringifyDoc(content, next), 'utf8');
  await rename(tmp, file);
  return { ...meta, ...patch };
}

/**
 * 手工拼装写盘文件：`---\n<yaml>\n---\n` + 正文原样。
 * 不用 matter.stringify 收尾：其 newline()（gray-matter 4.0.3 lib/stringify.js）
 * 仅在正文末尾无 '\n' 时才补换行，若再剥尾换行就会吃掉以 '\n' 结尾正文的
 * 最后一个换行（'B\n' 落盘为 'B'）。YAML 块仍复用 gray-matter 引擎序列化：
 * 对空正文调用 matter.stringify 得 `---\n<yaml>\n---\n\n`，去掉为空正文补上的
 * 那一个 '\n' 即得纯 frontmatter 块，正文不再经过任何条件补换行，逐字节往返。
 */
function stringifyDoc(content: string, data: Record<string, unknown>): string {
  const front = matter.stringify('', data).slice(0, -1); // `---\n<yaml>\n---\n`
  return front + content;
}

async function mustFind(root: string, id: string): Promise<ContentMeta> {
  const scan = await listContents(root);
  const meta = scan.items.find((m) => m.id === id && m.id !== '');
  if (!meta) {
    const err = new Error(`内容不存在: ${id}`) as Error & { code: string };
    err.code = 'CONTENT_NOT_FOUND'; throw err;
  }
  return meta;
}
