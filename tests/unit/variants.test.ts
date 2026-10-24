import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  readVariant, saveVariant, listVariants, parseVariantDraftMarkdown, applyVariantDraft, assertPlatform,
} from '../../src/main/variants';
import { saveDraft, draftsDir } from '../../src/main/drafts';
import { createContent } from '../../src/main/content-library';
import { makeLibrary } from '../helpers/libFixture';

describe('变体文件域', () => {
  let root = ''; let id = ''; let folder = '';
  beforeEach(async () => {
    root = makeLibrary();
    const meta = await createContent(root, { title: '变体测试' });
    id = meta.id; folder = meta.folder;
  });

  it('saveVariant 原子落 platforms/<platform>.md（frontmatter+正文原样），readVariant/listVariants 往返', async () => {
    await saveVariant(root, id, 'xiaohongshu', { title: '小红书标题', topics: ['话题A'], body: '正文一\n\n正文二' });
    const file = path.join(root, folder, 'platforms', 'xiaohongshu.md');
    expect(existsSync(file)).toBe(true);
    const raw = readFileSync(file, 'utf8');
    expect(raw).toContain('platform: xiaohongshu');
    expect(raw).toContain('title: 小红书标题');
    expect(raw.endsWith('正文一\n\n正文二')).toBe(true); // 正文逐字节保留（不经条件补换行）
    const doc = await readVariant(root, id, 'xiaohongshu');
    expect(doc).toMatchObject({ platform: 'xiaohongshu', title: '小红书标题', topics: ['话题A'], body: '正文一\n\n正文二' });
    expect(await readVariant(root, id, 'x')).toBeNull(); // 未保存的平台 null
    expect(await listVariants(root, id)).toEqual(['xiaohongshu']);
  });
  it('parseVariantDraftMarkdown：# 标题行 + 可选话题行 + 正文（技能产出格式）', () => {
    expect(parseVariantDraftMarkdown('# 我的标题\n话题: 话题A、话题B\n\n正文段落')).toEqual({ title: '我的标题', topics: ['话题A', '话题B'], body: '正文段落' });
    expect(parseVariantDraftMarkdown('没有标题行直接正文')).toEqual({ title: '', topics: [], body: '没有标题行直接正文' });
    expect(parseVariantDraftMarkdown('# 标\n话题: 逗号,分隔\n\n正文')).toEqual({ title: '标', topics: ['逗号', '分隔'], body: '正文' });
  });
  it('applyVariantDraft：草稿→解析→变体文件，草稿被消费', async () => {
    // 注：saveDraft 的 platform 元数据属 Task 2；此处 note=变体:<平台> 即变体草稿标记
    const d = await saveDraft(root, id, { markdown: '# 转化标题\n话题: 话题A\n\n转化正文', note: '变体:xiaohongshu' });
    const r = await applyVariantDraft(root, id, 'xiaohongshu', d.name);
    expect(r.savedAt).toBeTruthy();
    const doc = await readVariant(root, id, 'xiaohongshu');
    expect(doc).toMatchObject({ title: '转化标题', topics: ['话题A'], body: '转化正文' });
    expect(existsSync(path.join(draftsDir(root, id), d.name))).toBe(false);
  });
  it('assertPlatform 拒绝未知平台（VARIANT_BAD_PLATFORM，防 IPC 任意路径）', () => {
    expect(() => assertPlatform('xiaohongshu')).not.toThrow();
    expect(() => assertPlatform('../evil')).toThrowError(expect.objectContaining({ code: 'VARIANT_BAD_PLATFORM' }));
    expect(() => assertPlatform('zhihu')).toThrowError(expect.objectContaining({ code: 'VARIANT_BAD_PLATFORM' })); // M4 平台
  });
  it('内容不存在时抛 CONTENT_NOT_FOUND', async () => {
    await expect(readVariant(root, 'c_20990101_zzzz', 'x')).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
  });
});
