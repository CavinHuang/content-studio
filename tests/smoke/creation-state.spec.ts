import { test, expect } from '@playwright/test'
import { applyCreation, beginCreation, composeCreation, creationSnapshot, finishCreation } from '../../src/renderer/src/studio/creation'
import { makeProject, seedState } from '../../src/renderer/src/studio/mock'
import { makeDraft } from '../../src/renderer/src/studio/types'

const fixture = () => {
  const state = seedState()
  const project = makeProject()
  project.creation = { input: '我的主题\n一条未整理记录：只有 2 次观察。', status: 'idle' }
  state.projects.unshift(project)
  state.selectedProject = project.id
  return { state, project }
}

test('failure preserves input and drafts; retry actually replays composition', () => {
  const { state, project } = fixture()
  const first = beginCreation(state, project.id)
  const failed = finishCreation(first.state, project.id, first.runId!, () => { throw new Error('injected generator failure') })
  expect(failed.projects[0]!.creation?.status).toBe('failed')
  expect(failed.projects[0]!.creation?.input).toBe(project.creation!.input)
  expect(failed.projects[0]!.drafts).toEqual(project.drafts)
  const retry = beginCreation(failed, project.id)
  const result = finishCreation(retry.state, project.id, retry.runId!)
  expect(result.projects[0]!.creation?.status).toBe('ready')
  expect(result.projects[0]!.drafts.master!.body).toContain('只有 2 次观察')
})

test('snapshot keeps original material; unavailable sources are never invented', () => {
  const { state, project } = fixture()
  state.materials = [
    { id: 'raw', title: '未整理采访', type: 'text', body: '受访者说：我不确定。\n样本只有两人。', url: '', tags: [], at: '' },
    { id: 'url', title: '仅链接', type: 'link', body: '', url: 'https://example.org/unread', tags: [], at: '' },
    { id: 'image', title: '未读图', type: 'image', body: '', url: '', tags: [], at: '' },
    { id: 'other', title: '不属于本篇', type: 'text', body: 'PRIVATE-OTHER-PROJECT', url: '', tags: [], at: '' },
  ]
  project.materialIds = ['raw', 'url', 'image']
  project.brief.point = '不能推广到所有人'
  const snapshot = creationSnapshot(state, project)
  state.materials[0]!.body = '后来修改'
  const result = composeCreation(snapshot)
  expect(result.body).toContain('受访者说：我不确定。\n> 样本只有两人。')
  expect(result.body).toContain('不能推广到所有人')
  expect(result.body).toContain('未读取图片、文件或链接内容')
  expect(result.body).toContain('https://example.org/unread')
  expect(result.body).not.toContain('PRIVATE-OTHER-PROJECT')
  expect(result.body).not.toContain('后来修改')
})

test('missing intent asks once without losing raw input; large input is not silently truncated', () => {
  const { state, project } = fixture()
  project.creation!.input = 'https://example.org/source'
  const blocked = beginCreation(state, project.id)
  expect(blocked.runId).toBeUndefined()
  expect(blocked.state.projects[0]!.creation?.status).toBe('blocked')
  expect(blocked.state.projects[0]!.creation?.input).toBe(project.creation!.input)
  project.creation!.input = '主题\n' + '原始文字'.repeat(8000)
  expect(beginCreation(state, project.id).state.projects[0]!.creation?.message).toContain('容量')
})

test('old callbacks, duplicate runs and trashed projects never write; changing projects does not redirect results', () => {
  const { state, project } = fixture()
  const first = beginCreation(state, project.id)
  expect(beginCreation(first.state, project.id).runId).toBeUndefined()
  expect(finishCreation(first.state, project.id, 'old-run')).toBe(first.state)
  const other = first.state.projects[1]!
  first.state.selectedProject = other.id
  const otherBefore = structuredClone(other)
  const result = finishCreation(first.state, project.id, first.runId!)
  expect(result.selectedProject).toBe(other.id)
  expect(result.projects[1]).toEqual(otherBefore)
  expect(result.projects[0]!.creation?.status).toBe('ready')
  first.state.projects[0]!.trashed = true
  expect(finishCreation(first.state, project.id, first.runId!)).toBe(first.state)
})

test('manual edit while generating becomes a candidate; adoption versions both manual and generated text', () => {
  const { state, project } = fixture()
  const first = beginCreation(state, project.id)
  first.state.projects[0]!.drafts.master!.body = '手动正文，绝不覆盖'
  const result = finishCreation(first.state, project.id, first.runId!)
  expect(result.projects[0]!.drafts.master!.body).toBe('手动正文，绝不覆盖')
  expect(result.projects[0]!.creation?.status).toBe('candidate')
  const p = result.projects[0]!
  p.drafts.master = makeDraft('已有标题', '原有正文')
  p.drafts.master.body = '未存快照的手改'
  const adopted = applyCreation(p, '新标题', '新候选正文')
  expect(adopted.drafts.master!.versions.some(v => v.body === '未存快照的手改')).toBe(true)
  expect(adopted.creation!.applied!.previousBody).toBe('未存快照的手改')
})
