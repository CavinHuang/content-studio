import { test, expect } from '@playwright/test'
import {
  applyCreation,
  beginCreation,
  composeCreation,
  creationSnapshot,
  finishCreation,
  recoverCreation,
  stopCreationRun,
} from '../../src/renderer/src/studio/creation'
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

test('restart and backup restore stop running snapshots and invalidate old callbacks', () => {
  const { state, project } = fixture()
  const started = beginCreation(state, project.id)
  const running = started.state.projects[0]!
  const recovered = recoverCreation(running.creation)!
  expect(recovered.status).toBe('stopped')
  expect(recovered.runId).toBeUndefined()
  expect(recovered.input).toBe(project.creation!.input)
  expect(recovered.snapshot).toEqual(running.creation!.snapshot)
  running.creation = recovered
  expect(finishCreation(started.state, project.id, started.runId!)).toBe(started.state)
  const resumed = beginCreation(started.state, project.id)
  expect(resumed.runId).toBeTruthy()
  expect(finishCreation(resumed.state, project.id, resumed.runId!).projects[0]!.creation?.status).toBe(
    'ready',
  )
})

test('failure preserves input and drafts; retry actually replays composition', () => {
  const { state, project } = fixture()
  const first = beginCreation(state, project.id)
  const failed = finishCreation(first.state, project.id, first.runId!, () => {
    throw new Error('injected generator failure')
  })
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
    {
      id: 'raw',
      title: '未整理采访',
      type: 'text',
      body: '受访者说：我不确定。\n样本只有两人。',
      url: '',
      tags: [],
      at: '',
    },
    {
      id: 'url',
      title: '仅链接',
      type: 'link',
      body: '',
      url: 'https://example.org/unread',
      tags: [],
      at: '',
    },
    { id: 'image', title: '未读图', type: 'image', body: '', url: '', tags: [], at: '' },
    {
      id: 'other',
      title: '不属于本篇',
      type: 'text',
      body: 'PRIVATE-OTHER-PROJECT',
      url: '',
      tags: [],
      at: '',
    },
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
  expect(adopted.drafts.master!.versions.some((v) => v.body === '未存快照的手改')).toBe(true)
  expect(adopted.creation!.applied!.previousBody).toBe('未存快照的手改')
})

test('plan generation keeps raw records and linked materials, stages changes and tracks the actual task', () => {
  const { state, project } = fixture()
  project.drafts.master = makeDraft('已写标题', '作者手写正文')
  project.brief.topic = '新的方案选题'
  project.brief.outline = ['第一部分', '第二部分']
  project.materialIds = [state.materials[0]!.id]
  const started = beginCreation(state, project.id, 'plan')
  expect(started.state.tasks.filter((t) => t.id === started.runId)).toHaveLength(1)
  expect(started.state.tasks[0]!.state).toBe('running')
  expect(beginCreation(started.state, project.id, 'plan').state).toBe(started.state)
  const finished = finishCreation(started.state, project.id, started.runId!)
  const next = finished.projects[0]!
  expect(next.drafts.master!.body).toBe('作者手写正文')
  expect(next.creation!.status).toBe('candidate')
  expect(next.creation!.candidate!.title).toBe('新的方案选题')
  expect(next.creation!.candidate!.body).toContain(project.creation!.input.split('\n')[1]!)
  expect(next.creation!.candidate!.body.replace(/^> ?/gm, '')).toContain(state.materials[0]!.body)
  expect(next.creation!.candidate!.body).toContain('第一部分')
  expect(finished.tasks[0]!.state).toBe('complete')
  expect(finished.tasks[0]!.detail).toContain('候选')
})

test('a legacy project enters the same plan pipeline; changing plan or materials blocks automatic writing', () => {
  const { state, project } = fixture()
  delete project.creation
  project.brief.topic = '旧作品的方案'
  const started = beginCreation(state, project.id, 'plan')
  expect(started.runId).toBeTruthy()
  started.state.projects[0]!.brief.outline = ['生成期间新改的大纲']
  const finished = finishCreation(started.state, project.id, started.runId!)
  expect(finished.projects[0]!.drafts.master!.body).toBe('')
  expect(finished.projects[0]!.creation!.status).toBe('candidate')
  expect(finished.projects[0]!.creation!.snapshot).not.toEqual(
    creationSnapshot(finished, finished.projects[0]!),
  )
})

test('stopping and retrying a creation task preserves input, isolates projects and invalidates late callbacks', () => {
  const { state, project } = fixture()
  const first = beginCreation(state, project.id)
  const stopped = stopCreationRun(first.state, project.id)
  expect(stopped.tasks[0]!.state).toBe('stopped')
  expect(stopped.projects[0]!.creation!.input).toBe(project.creation!.input)
  expect(finishCreation(stopped, project.id, first.runId!)).toBe(stopped)
  stopped.selectedProject = stopped.projects[1]!.id
  const other = structuredClone(stopped.projects[1]!)
  const retry = beginCreation(stopped, project.id)
  const failed = finishCreation(retry.state, project.id, retry.runId!, () => {
    throw new Error('injected failure')
  })
  expect(failed.tasks[0]!.state).toBe('failed')
  expect(failed.tasks[1]!.state).toBe('stopped')
  const next = beginCreation(failed, project.id)
  const done = finishCreation(next.state, project.id, next.runId!)
  expect(done.tasks[0]!.state).toBe('complete')
  expect(done.projects[1]).toEqual(other)
  expect(done.selectedProject).toBe(other.id)
  expect(done.projects[0]!.drafts.master!.body).toContain('只有 2 次观察')
})
