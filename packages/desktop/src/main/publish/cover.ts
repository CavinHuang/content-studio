/**
 * 无封面时的占位封面 PNG（零依赖生成：PNG 签名 + IHDR + zlib IDAT + IEND）。
 * draft/add 的 thumb_media_id 必填（永久素材），用户未指定封面时先占位，
 * 草稿箱内可随时替换；结果里如实标记 cover: 'placeholder'。
 */
import { deflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([length, typeBuf, data, crc])
}

export type PlaceholderCover = { bytes: Uint8Array; filename: string; mimeType: 'image/png' }

/** 900×383（公众号封面比例 2.35∶1）纯色 PNG，rgb 默认产品主题深绿。 */
export function makePlaceholderCoverPng(
  width = 900,
  height = 383,
  rgb: readonly [number, number, number] = [47, 111, 78],
): PlaceholderCover {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor RGB
  const row = Buffer.alloc(1 + width * 3)
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 3] = rgb[0]
    row[1 + x * 3 + 1] = rgb[1]
    row[1 + x * 3 + 2] = rgb[2]
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
  return { bytes: new Uint8Array(png), filename: 'cover.png', mimeType: 'image/png' }
}
