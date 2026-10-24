// 独立文件：mock node:crypto 的 randomBytes，精确复现 id 撞号与重生成序列。
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ queue: [] as number[][] }));
vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return {
    ...actual,
    randomBytes: (n: number) => (h.queue.length ? Buffer.from(h.queue.shift()!) : actual.randomBytes(n)),
  };
});

import { createContent, listContents } from '../../src/main/content-library';
import { makeLibrary, addContent } from '../helpers/libFixture';

describe('createContent id 查重', () => {
  it('生成的 id 与库内现存 id 撞号时重生成，最终不重复', async () => {
    const root = makeLibrary();
    const d = new Date().toLocaleDateString('sv-SE').replaceAll('-', '');
    // 库内已存在 c_<今日>_aa00
    addContent(root, `${d}-已存在`, `id: c_${d}_aa00\ntitle: 已存在\nstage: idea\ntags: []\ncreated: "${d}"\nmedia: article`);
    // 第一次生成撞号（aa00），第二次生成 bb11
    h.queue.push([0xaa, 0x00], [0xbb, 0x11]);
    const meta = await createContent(root, { title: '撞号测试' });
    expect(meta.id).toBe(`c_${d}_bb11`);
    // 写盘的 frontmatter 与返回 id 一致，原内容未被覆盖
    const scan = await listContents(root);
    expect(scan.items.filter((m) => m.id === `c_${d}_aa00`)).toHaveLength(1);
    expect(scan.items.some((m) => m.id === `c_${d}_bb11`)).toBe(true);
  });
});
