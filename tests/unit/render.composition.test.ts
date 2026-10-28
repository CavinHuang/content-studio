import { describe, expect, test } from 'vitest'
import {
  COMPOSITION_ID,
  sanitizeFileName,
  shotFrames,
  totalFrames,
  type CompositionShot,
} from '../../packages/desktop/src/main/render/composition'

describe('shotFrames：durationMs → 帧数（spike §5 取整策略）', () => {
  test('按帧率四舍五入：1200ms@30fps=36 帧、1800ms@30fps=54 帧', () => {
    expect(shotFrames(1200, 30)).toBe(36)
    expect(shotFrames(1800, 30)).toBe(54)
  })
  test('非整秒时长不丢帧：1234ms@24fps=30 帧', () => {
    expect(shotFrames(1234, 24)).toBe(30)
  })
  test('极短分镜钳制为至少 1 帧', () => {
    expect(shotFrames(0, 30)).toBe(1)
    expect(shotFrames(10, 30)).toBe(1)
  })
  test('非法输入（NaN/负帧率/负时长）退化为 1 帧而不是 NaN', () => {
    expect(shotFrames(Number.NaN, 30)).toBe(1)
    expect(shotFrames(1000, 0)).toBe(1)
    expect(shotFrames(-500, 30)).toBe(1)
    expect(shotFrames(1000, Number.NaN)).toBe(1)
  })
})

describe('totalFrames：总时长由分镜数据决定（calculateMetadata 同源计算）', () => {
  test('spike 实证组合：1200+1800ms@30fps → 90 帧', () => {
    const shots: CompositionShot[] = [
      { id: 'a', title: '开场', durationMs: 1200 },
      { id: 'b', title: '收尾', durationMs: 1800 },
    ]
    expect(totalFrames(shots, 30)).toBe(90)
  })
  test('空分镜返回 0（由调用方在入队前校验拒绝）', () => {
    expect(totalFrames([], 30)).toBe(0)
  })
  test('含极短分镜时按每镜至少 1 帧累计', () => {
    const shots: CompositionShot[] = [
      { id: 'a', title: '一', durationMs: 0 },
      { id: 'b', title: '二', durationMs: 1000 },
    ]
    expect(totalFrames(shots, 30)).toBe(31)
  })
})

describe('sanitizeFileName：导出文件名只留安全字符', () => {
  test('保留中文/字母/数字/空格/连字符，压缩空白', () => {
    expect(sanitizeFileName('让创作回到 日常 · 口播')).toBe('让创作回到 日常 口播')
  })
  test('剥除路径分隔符与非法字符，防目录穿越', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j')).toBe('abcdefghij')
  })
  test('超长标题截断到 40 字符', () => {
    expect(sanitizeFileName('长'.repeat(60))).toHaveLength(40)
  })
  test('空串或全符号输入回退为 video', () => {
    expect(sanitizeFileName('')).toBe('video')
    expect(sanitizeFileName('???///')).toBe('video')
  })
  test('组合 ID 为固定值（渲染端与执行器共享契约）', () => {
    expect(COMPOSITION_ID).toBe('studio-video')
  })
})
