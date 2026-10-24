import { readFile, writeFile, rename, unlink, mkdir, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import matter from 'gray-matter';
import type { PlatformKey, VariantDoc } from '../shared/types';
import { isPlatformKey } from '../shared/platform-rules';
import { mustFind } from './content-library';
import { readDraft, draftsDir } from './drafts';

export function assertPlatform(platform: string): asserts platform is PlatformKey {
  if (!isPlatformKey(platform)) {
    const err = new Error(`未知平台: ${platform}`) as Error & { code: string };
    err.code = 'VARIANT_BAD_PLATFORM'; throw err;
  }
}

async function atomicWrite(file: string, contents: string): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try { await writeFile(tmp, contents, 'utf8'); await rename(tmp, file); }
  catch (err) { await unlink(tmp).catch(() => {}); throw err; }
}

export async function readVariant(root: string, contentId: string, platform: PlatformKey): Promise<VariantDoc | null> {
  assertPlatform(platform);
  const meta = await mustFind(root, contentId);
  const file = path.join(root, meta.folder, 'platforms', `${platform}.md`);
  let raw: string;
  try { raw = await readFile(file, 'utf8'); } catch { return null; }
  const { data, content } = matter(raw);
  return {
    platform,
    title: String(data.title ?? ''),
    topics: Array.isArray(data.topics) ? data.topics.map(String) : [],
    body: content.replace(/^\n+/, ''),
    ...(data.digest ? { digest: String(data.digest) } : {}),
    ...(data.cover ? { cover: String(data.cover) } : {}),
    ...(data.updated ? { updatedAt: String(data.updated) } : {}),
  };
}

export async function saveVariant(
  root: string, contentId: string, platform: PlatformKey,
  input: { title: string; topics: string[]; body: string; digest?: string; cover?: string },
): Promise<{ savedAt: string }> {
  assertPlatform(platform);
  const meta = await mustFind(root, contentId);
  const dir = path.join(root, meta.folder, 'platforms');
  await mkdir(dir, { recursive: true });
  const updated = new Date().toISOString();
  const data: Record<string, unknown> = { platform, title: input.title, topics: input.topics, updated };
  if (input.digest) data.digest = input.digest;
  if (input.cover) data.cover = input.cover;
  // 与 content-library 同策略：gray-matter 序列化 YAML 块后不做条件补换行，正文逐字节保留
  const front = matter.stringify('', data).slice(0, -1);
  const file = path.join(dir, `${platform}.md`);
  await atomicWrite(file, front + input.body);
  return { savedAt: updated };
}

export async function listVariants(root: string, contentId: string): Promise<PlatformKey[]> {
  const meta = await mustFind(root, contentId);
  const dir = path.join(root, meta.folder, 'platforms');
  try {
    const entries = await readdir(dir);
    return entries.filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).filter(isPlatformKey);
  } catch { return []; }
}

/** 技能产出的变体草稿格式：首行 `# 标题`，可选 `话题: A、B`（顿号/逗号分隔），空行后正文。 */
export function parseVariantDraftMarkdown(md: string): { title: string; topics: string[]; body: string } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  let title = '';
  let topics: string[] = [];
  let i = 0;
  if (lines[0]?.startsWith('# ')) { title = lines[0].slice(2).trim(); i = 1; }
  const topicLine = lines[i]; // 局部常量收窄（noUncheckedIndexedAccess 下 let 索引不被守卫收窄）
  if (topicLine?.startsWith('话题:')) {
    topics = topicLine.slice(3).split(/[、,，]/).map((t) => t.trim()).filter(Boolean);
    i += 1;
  }
  return { title, topics, body: lines.slice(i).join('\n').replace(/^\n+/, '') };
}

/** 人确认动作：变体草稿 → 解析 → platforms/<platform>.md（原子写）→ 消费草稿。 */
export async function applyVariantDraft(
  root: string, contentId: string, platform: PlatformKey, draftName: string,
): Promise<{ savedAt: string }> {
  assertPlatform(platform);
  const md = await readDraft(root, contentId, draftName);
  const { title, topics, body } = parseVariantDraftMarkdown(md);
  const r = await saveVariant(root, contentId, platform, { title, topics, body });
  await unlink(path.join(draftsDir(root, contentId), draftName)).catch(() => {});
  return r;
}
