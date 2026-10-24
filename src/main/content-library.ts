import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import type { ContentMeta, LibraryScan, Stage } from '../shared/types';
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
