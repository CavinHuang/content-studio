import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { buildDomainTools, domainToolNames } from '../../packages/desktop/src/main/ai/domain-tools'
import { loadPi, loadTypebox } from '../../packages/desktop/src/main/ai/pi-loader'

describe('领域工具（真实 pi defineTool 构建）', () => {
  test('三工具构建且名单正确', async () => {
    const [pi, T] = await Promise.all([loadPi(), loadTypebox()])
    const tools = await buildDomainTools(pi, T, { askUser: async () => '', collect: () => {} })
    expect(tools).toHaveLength(3)
    expect(domainToolNames()).toEqual(['write_suggestion', 'write_master_draft', 'ask_user'])
  })

  test('write_suggestion 收集 payload 并拒绝空值', async () => {
    const [pi, T] = await Promise.all([loadPi(), loadTypebox()])
    const collected: unknown[] = []
    const tools = await buildDomainTools(pi, T, { askUser: async () => '', collect: (item) => collected.push(item) })
    const suggestion = tools[0] as unknown as {
      execute(id: string, params: Record<string, string>): Promise<{ content: { text: string }[]; isError?: boolean }>
    }
    const ok = await suggestion.execute('run-1', {
      platform: 'master',
      original: '旧句子',
      replacement: '新句子',
      note: '更简洁',
    })
    expect(ok.isError).toBeUndefined()
    expect(ok.content[0]!.text).toContain('等待作者采用')
    expect(collected).toEqual([
      { kind: 'suggestion', payload: { platform: 'master', original: '旧句子', replacement: '新句子', note: '更简洁' } },
    ])
    const bad = await suggestion.execute('run-1', { platform: 'master', original: ' ', replacement: 'x' })
    expect(bad.isError).toBe(true)
  })

  test('write_master_draft 收集候选', async () => {
    const [pi, T] = await Promise.all([loadPi(), loadTypebox()])
    const collected: unknown[] = []
    const tools = await buildDomainTools(pi, T, { askUser: async () => '', collect: (item) => collected.push(item) })
    const draft = tools[1] as unknown as {
      execute(id: string, params: Record<string, string>): Promise<{ content: { text: string }[]; isError?: boolean }>
    }
    const ok = await draft.execute('run-1', { title: '标题', body: '# 正文', note: '按方案生成' })
    expect(ok.isError).toBeUndefined()
    expect(collected).toEqual([{ kind: 'draft', payload: { title: '标题', body: '# 正文', note: '按方案生成' } }])
  })
})
