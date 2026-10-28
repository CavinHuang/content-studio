import { describe, expect, test } from 'vitest'
import { loadPi, loadTypebox } from '../../packages/desktop/src/main/ai/pi-loader'

describe('pi loader（Node 24 动态 import 实证）', () => {
  test('loadPi 返回 pi 1.4.0 且不加载 TUI 路径', async () => {
    const pi = await loadPi()
    expect(pi.createAgentSession).toBeTypeOf('function')
    expect(pi.ModelRuntime).toBeTypeOf('function')
    expect(pi.DefaultResourceLoader).toBeTypeOf('function')
    expect(pi.loadSkillsFromDir).toBeTypeOf('function')
  })

  test('loadTypebox 提供 schema 构造器', async () => {
    const T = await loadTypebox()
    expect(T.Type.Object).toBeTypeOf('function')
    expect(T.Type.String).toBeTypeOf('function')
  })
})
