import { describe, it, expect } from 'vitest';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { listContents } from '../../src/main/content-library';
import { makeLibrary, addContent } from '../helpers/libFixture';

describe('listContents', () => {
  it('扫描 content.md 并解析 frontmatter 为 ContentMeta', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-测试文章',
      'id: c_20261024_ab12\ntitle: 测试文章\nstage: draft\ntags: [AI, 写作]\ncreated: "2026-10-24"\nmedia: article');
    const scan = await listContents(root);
    expect(scan.items).toHaveLength(1);
    expect(scan.items[0]).toEqual({
      id: 'c_20261024_ab12', title: '测试文章', stage: 'draft',
      tags: ['AI', '写作'], created: '2026-10-24', media: 'article',
      folder: '2026-10-24-测试文章',
    });
  });
  it('跳过 .studio 隐藏目录与无 content.md 的目录并记入 warnings', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-a', 'id: c_20261024_aa00\ntitle: a\nstage: idea\ntags: []\ncreated: "2026-10-24"\nmedia: article');
    mkdirSync(path.join(root, '.studio'), { recursive: true });
    mkdirSync(path.join(root, '空目录'), { recursive: true });
    const { items, warnings } = await listContents(root);
    expect(items).toHaveLength(1);
    expect(warnings.some((w) => w.includes('.studio'))).toBe(true);
    expect(warnings.some((w) => w.includes('空目录'))).toBe(true);
  });
  it('frontmatter 缺省字段取默认值（stage=idea/media=article/tags=[]）', async () => {
    const root = makeLibrary();
    addContent(root, '2026-10-24-裸', 'id: c_20261024_bb11\ntitle: 裸\ncreated: "2026-10-24"');
    const scan = await listContents(root);
    expect(scan.items[0]?.stage).toBe('idea');
    expect(scan.items[0]?.media).toBe('article');
    expect(scan.items[0]?.tags).toEqual([]);
  });
});
