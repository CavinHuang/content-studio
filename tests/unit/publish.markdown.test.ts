import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import {
  markdownToWechatHtml,
  parseDataUrl,
  replaceUploadImages,
  safeJoin,
  type ContentImageUpload,
} from '../../packages/desktop/src/main/publish/markdown-to-wechat-html'

describe('markdownToWechatHtml：极小转换器（draft/add 链：转义在前、不产 JS）', () => {
  test('标题/段落/加粗/斜体/引用/分隔线', () => {
    const html = markdownToWechatHtml(
      ['# 大标题', '', '第一段，含**加粗**与*斜体*。', '', '> 引用一句', '', '---', '', '第二段。'].join('\n'),
    )
    expect(html).toBe(
      [
        '<h2>大标题</h2>',
        '<p>第一段，含<strong>加粗</strong>与<em>斜体</em>。</p>',
        '<blockquote>引用一句</blockquote>',
        '<hr />',
        '<p>第二段。</p>',
      ].join('\n'),
    )
  })

  test('二级三级标题映射到 h3/h4（与预览端层级一致）', () => {
    const html = markdownToWechatHtml('## 二级\n\n### 三级')
    expect(html).toBe('<h3>二级</h3>\n<h4>三级</h4>')
  })

  test('列表：相邻的 - 与 1. 行分别聚合为 ul/ol', () => {
    const html = markdownToWechatHtml(['- 甲', '- 乙', '', '1. 第一', '2. 第二'].join('\n'))
    expect(html).toBe('<ul>\n<li>甲</li>\n<li>乙</li>\n</ul>\n<ol>\n<li>第一</li>\n<li>第二</li>\n</ol>')
  })

  test('连续引用行合并为一个 blockquote；CRLF 归一', () => {
    const html = markdownToWechatHtml('> 第一行\r\n> 第二行\r\n\r\n正文')
    expect(html).toBe('<blockquote>第一行 第二行</blockquote>\n<p>正文</p>')
  })

  test('转义在前：正文中的原始 HTML 全部转义，绝不产出 script', () => {
    const html = markdownToWechatHtml('<script>alert(1)</script>\n\n<b>伪粗体</b>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('&lt;b&gt;伪粗体&lt;/b&gt;')
    expect(html).not.toMatch(/<script|<b>/)
  })

  test('链接与图片：属性随整体转义，不二次转义', () => {
    const html = markdownToWechatHtml('[文档](https://a.com/?q=1&x=2)\n\n![说明](data:image/png;base64,QUJD)')
    expect(html).toContain('<a href="https://a.com/?q=1&amp;x=2">文档</a>')
    expect(html).toContain('<img src="data:image/png;base64,QUJD" alt="说明" />')
  })

  test('段落内换行合并为空格（公众号段落语义）', () => {
    expect(markdownToWechatHtml('同一句\n话拆两行')).toBe('<p>同一句 话拆两行</p>')
  })
})

describe('parseDataUrl', () => {
  test('合法 base64 图片可解析出字节与扩展名', () => {
    const parsed = parseDataUrl('data:image/png;base64,QUJD') // 'ABC'
    expect(parsed?.mimeType).toBe('image/png')
    expect(parsed?.ext).toBe('png')
    expect(Buffer.from(parsed!.bytes).toString('utf8')).toBe('ABC')
    const jpg = parseDataUrl('data:image/jpeg;base64,QUJD')
    expect(jpg?.ext).toBe('jpg')
  })
  test('非图片或非法 data URL 返回 null', () => {
    expect(parseDataUrl('data:text/plain;base64,QUJD')).toBeNull()
    expect(parseDataUrl('https://example.com/a.png')).toBeNull()
    expect(parseDataUrl('data:image/png;base64,!!!')).toBeNull()
  })
})

describe('safeJoin：路径越界防护', () => {
  test('目录内相对路径通过；越界路径抛 ASSET_OUT_OF_FOLDER', () => {
    const base = mkdtempSync(join(tmpdir(), 'studio-md-'))
    expect(safeJoin(base, 'img/a.png')).toBe(join(base, 'img', 'a.png'))
    try {
      safeJoin(base, '../outside.png')
      expect.unreachable('越界路径应当抛错')
    } catch (err) {
      expect((err as NodeJS.ErrnoException).code).toBe('ASSET_OUT_OF_FOLDER')
      expect((err as Error).message).toContain('路径越出')
    }
  })
})

function neverUpload(): ContentImageUpload {
  return async () => {
    throw new Error('不应触发上传')
  }
}

describe('replaceUploadImages：正文图 uploadimg 替换链路', () => {
  const pngDataUrl = 'data:image/png;base64,QUJD'

  test('data: 与 asset: 图片逐个经 uploadimg 换成微信 URL；同一 src 只上传一次', async () => {
    const uploads: Array<{ filename: string; mimeType: string; size: number }> = []
    const upload: ContentImageUpload = async ({ bytes, filename, mimeType }) => {
      uploads.push({ filename, mimeType, size: bytes.length })
      return `https://mmbiz.qpic.cn/${filename}`
    }
    const source = `<p><img src="${pngDataUrl}" alt="a" /></p><p><img src="asset:m1" alt="b" /></p><p><img src="${pngDataUrl}" alt="a2" /></p>`
    const result = await replaceUploadImages(source, {
      upload,
      assets: { m1: 'data:image/jpeg;base64,REVG' },
    })
    expect(uploads).toHaveLength(2) // data 去重后 1 次 + asset 1 次
    expect(uploads[0]).toMatchObject({ mimeType: 'image/png', size: 3 })
    expect(uploads[1]).toMatchObject({ mimeType: 'image/jpeg', size: 3 })
    expect(uploads.every((item) => /^image-[0-9a-f]{8}\.(png|jpg)$/.test(item.filename))).toBe(true)
    expect(result.uploaded).toBe(2)
    expect(result.external).toBe(0)
    expect(result.unresolved).toEqual([])
    expect(result.html).not.toContain('data:image')
    expect(result.html).not.toContain('asset:')
    expect(result.html).toMatch(/src="https:\/\/mmbiz\.qpic\.cn\/image-[0-9a-f]{8}\.png"/)
    expect(result.html).toMatch(/src="https:\/\/mmbiz\.qpic\.cn\/image-[0-9a-f]{8}\.jpg"/)
  })

  test('http 外链图不修改、如实计数（微信会屏蔽，交给上层提示）', async () => {
    const result = await replaceUploadImages('<p><img src="https://cdn.example.com/a.png" alt="a" /></p>', {
      upload: neverUpload(),
    })
    expect(result).toMatchObject({ uploaded: 0, external: 1, unresolved: [] })
    expect(result.html).toContain('src="https://cdn.example.com/a.png"')
  })

  test('asset: 引用缺失快照时保留原样并记入 unresolved', async () => {
    const result = await replaceUploadImages('<p><img src="asset:gone" alt="a" /></p>', {
      upload: neverUpload(),
      assets: {},
    })
    expect(result.uploaded).toBe(0)
    expect(result.unresolved).toEqual(['asset:gone'])
    expect(result.html).toContain('src="asset:gone"')
  })

  test('本地相对路径文件经 safeJoin 读取后上传', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-img-'))
    writeFileSync(join(dir, 'photo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    const uploads: string[] = []
    const result = await replaceUploadImages('<p><img src="photo.png" alt="a" /></p>', {
      upload: async ({ filename }) => {
        uploads.push(filename)
        return 'https://mmbiz.qpic.cn/local.png'
      },
      baseDir: dir,
    })
    expect(uploads).toEqual(['photo.png'])
    expect(result).toMatchObject({ uploaded: 1, unresolved: [] })
    expect(result.html).toContain('src="https://mmbiz.qpic.cn/local.png"')
  })

  test('本地路径越界即抛错，不上传任何字节', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'studio-img-'))
    await expect(
      replaceUploadImages('<p><img src="../escape.png" alt="a" /></p>', { upload: neverUpload(), baseDir: dir }),
    ).rejects.toMatchObject({ code: 'ASSET_OUT_OF_FOLDER' })
  })

  test('无 baseDir 的相对路径：不猜路径，记入 unresolved', async () => {
    const result = await replaceUploadImages('<p><img src="loose.png" alt="a" /></p>', { upload: neverUpload() })
    expect(result.unresolved).toEqual(['loose.png'])
    expect(result.html).toContain('src="loose.png"')
  })
})
