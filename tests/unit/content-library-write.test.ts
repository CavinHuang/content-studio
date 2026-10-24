// 独立文件：部分 mock node:fs/promises 的 rename/writeFile，
// 验证 writeBody 的唯一临时名与 rename 失败后的 best-effort 清理。
import { describe, it, expect, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import path from 'node:path';

const h = vi.hoisted(() => ({ wrotePaths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // 记录每次落盘路径（含临时名），行为不变
    writeFile: ((p: string, data: string, ...rest: unknown[]) => {
      h.wrotePaths.push(p);
      return (actual.writeFile as (...a: unknown[]) => Promise<void>)(p, data, ...rest);
    }) as typeof actual.writeFile,
    // rename 恒失败：触发失败清理路径
    rename: vi.fn(async () => { throw new Error('rename boom'); }),
  };
});

import { createContent, writeBody } from '../../src/main/content-library';
import { makeLibrary } from '../helpers/libFixture';

describe('原子写失败路径', () => {
  it('rename 失败时 best-effort unlink 清理临时文件并重抛原始错误', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '失败清理' });
    const folder = path.join(root, meta.folder);
    const before = readdirSync(folder);
    await expect(writeBody(root, meta.id, 'x')).rejects.toThrow('rename boom');
    // 临时文件已被清理，目录内容与失败前一致（content.md 原样保留）
    expect(readdirSync(folder).sort()).toEqual(before.sort());
  });
  it('每次写入用唯一临时名（连续两次写入的 .tmp 路径不同）', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '唯一名' });
    const file = path.join(root, meta.folder, 'content.md');
    h.wrotePaths.length = 0;
    await expect(writeBody(root, meta.id, 'a')).rejects.toThrow('rename boom');
    await expect(writeBody(root, meta.id, 'b')).rejects.toThrow('rename boom');
    const tmps = h.wrotePaths.filter((p) => p !== file && p.endsWith('.tmp'));
    expect(tmps).toHaveLength(2);
    expect(tmps[0]).not.toBe(tmps[1]);
  });
});
