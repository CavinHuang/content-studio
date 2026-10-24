import { describe, it, expect } from 'vitest';
import { mkdirSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { listContents, createContent, readContent, writeBody, updateMeta } from '../../src/main/content-library';
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

describe('createContent / readContent', () => {
  it('创建规范文件夹与 frontmatter，id 格式 c_YYYYMMDD_hex4', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '你好 世界/测试:A', tags: ['AI'] });
    expect(meta.id).toMatch(/^c_\d{8}_[0-9a-f]{4}$/);
    expect(meta.folder).toMatch(/^2026-\d{2}-\d{2}-你好-世界-测试-A$/);
    expect(meta.stage).toBe('idea');
    expect(existsSync(path.join(root, meta.folder, 'content.md'))).toBe(true);
    expect(existsSync(path.join(root, meta.folder, 'assets'))).toBe(true);
    const raw = readFileSync(path.join(root, meta.folder, 'content.md'), 'utf8');
    expect(raw).toContain(`id: ${meta.id}`);
    expect(raw).toContain('title: 你好 世界/测试:A');
  });
  it('同名文件夹冲突时追加 -2 去重', async () => {
    const root = makeLibrary();
    const a = await createContent(root, { title: '重复' });
    const b = await createContent(root, { title: '重复' });
    expect(a.folder).not.toBe(b.folder);
  });
  it('sanitize 剥离控制字符与结尾句点（含 50 截断后的二次剥离）', async () => {
    const root = makeLibrary();
    const a = await createContent(root, { title: '控\u0007制\u001F字\u007F符..' });
    expect(a.folder).toMatch(/控制字符$/); // 控制字符剥离、结尾句点不进目录名
    // 50 字符截断恰好切在句点上：截断后需再次剥离结尾句点
    const b = await createContent(root, { title: 'x'.repeat(49) + '.尾巴' });
    expect(b.folder).toMatch(/x{49}$/);
    expect(b.folder.endsWith('.')).toBe(false);
    const c = await createContent(root, { title: '...' }); // 全句点 → 兜底名
    expect(c.folder).toMatch(/未命名$/);
  });
  it('created/folder 日期取本地时区日期（sv-SE 的 YYYY-MM-DD）', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '日期' });
    const local = new Date().toLocaleDateString('sv-SE');
    expect(meta.created).toBe(local);
    expect(meta.folder.startsWith(`${local}-`)).toBe(true);
  });
  it('readContent 返回 meta+body；不存在时 code=CONTENT_NOT_FOUND', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: 'x' });
    const content = await readContent(root, meta.id);
    expect(content.body).toBe('');
    await expect(readContent(root, 'c_20260101_zzzz')).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
  });
});

describe('writeBody / updateMeta', () => {
  it('writeBody 原子写正文，frontmatter 不丢', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '原子' });
    await writeBody(root, meta.id, '# 标题\n\n第一段');
    const c = await readContent(root, meta.id);
    expect(c.body).toBe('# 标题\n\n第一段');
    expect(c.title).toBe('原子');
  });
  it('writeBody 后目录中不残留 .tmp 文件', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: 'tmp' });
    await writeBody(root, meta.id, 'x');
    expect(readdirSync(path.join(root, meta.folder)).some((f) => f.endsWith('.tmp'))).toBe(false);
  });
  it('updateMeta 改 stage/tags/title 且正文逐字节保留', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '旧标题', tags: ['a'] });
    await writeBody(root, meta.id, '正文保持\n第二行\n');
    const before = (await readContent(root, meta.id)).body;
    const next = await updateMeta(root, meta.id, { stage: 'review', tags: ['b', 'c'], title: '新标题' });
    expect(next.stage).toBe('review');
    const after = await readContent(root, next.id);
    expect(after.body).toBe(before);
    expect(after.title).toBe('新标题');
    expect(after.tags).toEqual(['b', 'c']);
  });
  it('正文以 \\n 结尾时磁盘字节不变（writeBody/updateMeta 不吞尾换行）', async () => {
    const root = makeLibrary();
    const meta = await createContent(root, { title: '尾换行' });
    const file = path.join(root, meta.folder, 'content.md');
    await writeBody(root, meta.id, 'B\n');
    const afterWrite = readFileSync(file, 'utf8');
    expect(afterWrite.endsWith('---\nB\n')).toBe(true); // 尾部 '\n' 未被吃掉
    // 取磁盘文件关闭定界符之后的正文字节区
    const bodyBytes = (raw: string) => raw.slice(raw.indexOf('\n---\n', 3) + 5);
    await updateMeta(root, meta.id, { stage: 'draft' });
    const afterUpdate = readFileSync(file, 'utf8');
    expect(bodyBytes(afterUpdate)).toBe('B\n');
    expect(bodyBytes(afterUpdate)).toBe(bodyBytes(afterWrite));
  });
});
