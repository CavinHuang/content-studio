import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { markdownToWechatHtml, replaceLocalImages, safeJoin } from '../../src/main/publish/markdown-to-wechat-html';
import { makeLibrary } from '../helpers/libFixture';

describe('markdown → 公众号 HTML', () => {
  it('标题/段落/加粗/斜体/链接/图片/引用/分隔线，HTML 转义在前', () => {
    const html = markdownToWechatHtml('# 大标题\n\n段落<b>加粗</b>与[链接](https://a.com)\n\n![图](assets/a.png)\n\n> 引用\n\n---\n\n尾段');
    expect(html).toContain('<h2>大标题</h2>');
    expect(html).toContain('<p>段落&lt;b&gt;加粗&lt;/b&gt;与<a href="https://a.com">链接</a></p>');
    expect(html).toContain('<img src="assets/a.png" alt="图" />');
    expect(html).toContain('<blockquote>引用</blockquote>');
    expect(html).toContain('<hr />');
    expect(html).toContain('<p>尾段</p>');
  });
  it('行内标记：**加粗** 与 *斜体*', () => {
    expect(markdownToWechatHtml('**粗** 与 *斜*')).toContain('<strong>粗</strong>');
    expect(markdownToWechatHtml('**粗** 与 *斜*')).toContain('<em>斜</em>');
  });
  it('safeJoin 拒绝越出内容目录的相对路径', () => {
    expect(safeJoin('C:/lib/a', 'assets/cover.png').endsWith(path.join('assets', 'cover.png'))).toBe(true);
    expect(() => safeJoin('C:/lib/a', '../evil.png')).toThrowError(expect.objectContaining({ code: 'ASSET_OUT_OF_FOLDER' }));
  });
  it('replaceLocalImages：本地 src 全部替换为上传 URL，http(s) 不动', async () => {
    const lib = makeLibrary();
    mkdirSync(path.join(lib, '2026-10-24-a', 'assets'), { recursive: true });
    writeFileSync(path.join(lib, '2026-10-24-a', 'assets', 'a.png'), new Uint8Array([1, 2, 3]));
    const html = '<p><img src="assets/a.png" /></p><img src="https://x/b.png" />';
    const out = await replaceLocalImages(html, path.join(lib, '2026-10-24-a'), async (bytes, name) => {
      expect(bytes.length).toBe(3);
      expect(name).toBe('a.png');
      return `https://mmbiz/${name}`;
    });
    expect(out).toContain('src="https://mmbiz/a.png"');
    expect(out).toContain('src="https://x/b.png"');
    expect(out).not.toContain('assets/a.png');
  });
});
