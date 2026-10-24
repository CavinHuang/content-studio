import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  saveDraft, listDrafts, readDraft, applyDraft, discardDraft, draftsDir,
} from '../../src/main/drafts';
import { createContent, readContent } from '../../src/main/content-library';
import { makeLibrary } from '../helpers/libFixture';

describe('草稿区', () => {
  let root = '';
  let id = '';
  beforeEach(async () => {
    root = makeLibrary();
    id = (await createContent(root, { title: '草稿测试' })).id;
  });

  it('saveDraft 落 .studio/drafts/<id>/，listDrafts 可见元数据，readDraft 原样返回正文', async () => {
    const d = await saveDraft(root, id, { markdown: '# 初稿\n\n第一段', note: '长文初稿' });
    expect(d.name).toMatch(/^draft-\d{8}-\d{6}-[0-9a-f]{4}\.md$/);
    expect(existsSync(path.join(draftsDir(root, id), d.name))).toBe(true);
    const list = await listDrafts(root, id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: d.name, note: '长文初稿', bytes: Buffer.byteLength('# 初稿\n\n第一段', 'utf8') });
    expect(await readDraft(root, id, d.name)).toBe('# 初稿\n\n第一段');
  });
  it('listDrafts 目录不存在返回 []；多草稿全部可见且首条不早于末条（时间倒序）', async () => {
    expect(await listDrafts(root, 'c_20260101_none')).toEqual([]);
    const a = await saveDraft(root, id, { markdown: 'a' });
    const b = await saveDraft(root, id, { markdown: 'b' });
    const list = await listDrafts(root, id);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((x) => x.name))).toEqual(new Set([a.name, b.name]));
    expect(list[0]!.created.localeCompare(list[1]!.created)).toBeGreaterThanOrEqual(0);
  });
  it('applyDraft 人确认后经 writeBody 进正文（frontmatter 保留），草稿被消费', async () => {
    await saveDraft(root, id, { markdown: '# 采纳稿\n\n正文', note: '审稿改稿' });
    const list = await listDrafts(root, id);
    const r = await applyDraft(root, id, list[0]!.name);
    expect(r.savedAt).toBeTruthy();
    const c = await readContent(root, id);
    expect(c.body).toBe('# 采纳稿\n\n正文');   // 正文=草稿全文
    expect(c.title).toBe('草稿测试');           // frontmatter 不丢
    expect(await listDrafts(root, id)).toEqual([]);
  });
  it('discardDraft 删除草稿；路径逃逸名被拒（DRAFT_BAD_NAME）', async () => {
    const d = await saveDraft(root, id, { markdown: 'x' });
    await discardDraft(root, id, d.name);
    expect(await listDrafts(root, id)).toEqual([]);
    await expect(readDraft(root, id, '../../settings.json')).rejects.toMatchObject({ code: 'DRAFT_BAD_NAME' });
    await expect(discardDraft(root, id, 'a/../../b.md')).rejects.toMatchObject({ code: 'DRAFT_BAD_NAME' });
    expect(readdirSync(path.join(root, '.studio')).length).toBeGreaterThan(-1); // .studio 仍在
  });
});
