import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, test, vi } from 'vitest'
import type { TaskEvent, TaskRecord } from '../../packages/desktop/src/shared/desktop'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import type { MainExecutor } from '../../packages/desktop/src/main/tasks/runner'
import {
  createExportExecutor,
  type RenderApi,
  type VideoExportPayload,
} from '../../packages/desktop/src/main/render/export-job'

let db: DatabaseSync | undefined
const tempDirs: string[] = []
afterEach(() => {
  db?.close()
  db = undefined
  // Windows 上 SQLite WAL 句柄释放有延迟：清理是尽力而为，失败留给系统临时目录回收。
  for (const dir of tempDirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      /* 尽力清理 */
    }
  }
})

function tempDir(label: string): string {
  const dir = mkdtempSync(join(tmpdir(), `studio-${label}-`))
  tempDirs.push(dir)
  return dir
}

function payload(over: Partial<VideoExportPayload> = {}): VideoExportPayload {
  return {
    videoId: 'v1',
    version: 3,
    title: '让创作回到日常 · 口播',
    fps: 30,
    width: 1080,
    height: 1920,
    shots: [
      { id: 's1', title: '留住灵感', subtitle: '先留住灵感', image: 'data:image/svg+xml;utf8,%3Csvg/%3E', durationMs: 6000 },
      { id: 's2', title: '形成观点', durationMs: 12000 },
    ],
    ...over,
  }
}

type FakeApi = {
  api: RenderApi
  bundle: ReturnType<typeof vi.fn>
  selectComposition: ReturnType<typeof vi.fn>
  renderMedia: ReturnType<typeof vi.fn>
  cancel: ReturnType<typeof vi.fn>
  bundleDir: string
}

/** 假渲染器：不装浏览器不打包，按 spike 验证过的调用契约推进（bundle→select→render→progress）。 */
function fakeRenderApi(root: string, over: {
  render?: (
    options: Parameters<RenderApi['renderMedia']>[0],
    helpers: { api: FakeApi; emitProgress: (p: { renderedFrames: number; stitchStage: 'encoding' | 'muxing' }) => void },
  ) => Promise<void>
} = {}): FakeApi {
  const bundleDir = join(root, 'fake-bundle')
  const bundle = vi.fn(async () => {
    mkdirSync(bundleDir, { recursive: true })
    writeFileSync(join(bundleDir, 'index.html'), 'bundle')
    return bundleDir
  })
  const selectComposition = vi.fn(async () => ({
    id: 'studio-video',
    durationInFrames: 540,
    width: 1080,
    height: 1920,
    fps: 30,
  }))
  const renderMedia = vi.fn(async (options: Parameters<RenderApi['renderMedia']>[0]) => {
    const emitProgress = (p: { renderedFrames: number; stitchStage: 'encoding' | 'muxing' }) =>
      options.onProgress?.({ renderedFrames: p.renderedFrames, encodedFrames: p.renderedFrames, stitchStage: p.stitchStage })
    const helpers = { api: fake as FakeApi, emitProgress }
    if (over.render) return over.render(options, helpers)
    emitProgress({ renderedFrames: 1, stitchStage: 'encoding' })
    emitProgress({ renderedFrames: 1, stitchStage: 'encoding' })
    emitProgress({ renderedFrames: 540, stitchStage: 'encoding' })
    emitProgress({ renderedFrames: 540, stitchStage: 'muxing' })
    writeFileSync(options.outputLocation, 'fake-mp4-bytes')
  })
  const cancel = vi.fn()
  const fake = {
    api: { bundle, selectComposition, renderMedia, makeCancelSignal: () => ({ cancelSignal: {}, cancel }) },
    bundle,
    selectComposition,
    renderMedia,
    cancel,
    bundleDir,
  } as FakeApi
  return fake
}

function makeRunner(executor: MainExecutor) {
  db = openDatabase(join(tempDir('export-runner'), 'studio.db'))
  migrate(db)
  const events: TaskEvent[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => events.push(event))
  runner.registerExecutor('export', executor)
  return { runner, events }
}

async function runToSettled(runner: TaskRunner, submit: Parameters<TaskRunner['submit']>[0]): Promise<TaskRecord> {
  const task = runner.submit(submit)
  for (let i = 0; i < 200 && runner.get(task.id)!.state === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return runner.get(task.id)!
}

function exportTaskRecord(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: '01234567-89ab-cdef-0123-456789abcdef',
    title: '视频导出 · 让创作回到日常',
    detail: '正在导出…',
    projectId: 'p1',
    state: 'running',
    kind: 'export',
    at: '2026-10-28T00:00:00.000Z',
    updated: '2026-10-28T00:00:00.000Z',
    executor: 'main',
    payload: payload(),
    ...over,
  }
}

test('全链路（经 TaskRunner）：真实进度 → complete 带产物 → bundle 目录清理', async () => {
  const root = tempDir('export-ok')
  const exportsDir = join(root, 'exports')
  const entry = join(root, 'remotion', 'index.tsx')
  mkdirSync(join(root, 'remotion'), { recursive: true })
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const { runner } = makeRunner(
    createExportExecutor({ entryPoint: () => entry, exportsDir: () => exportsDir, loadApi: async () => fake.api }),
  )
  const settled = await runToSettled(runner, {
    id: '01234567-89ab-cdef-0123-456789abcdef',
    kind: 'export',
    executor: 'main',
    title: '视频导出 · 让创作回到日常',
    detail: '正在导出…',
    projectId: 'p1',
    payload: payload(),
    extra: { videoId: 'v1', version: 3 },
  })
  expect(settled.state).toBe('complete')
  expect(settled.result).toMatchObject({
    fileName: '让创作回到日常 口播-v3-01234567.mp4',
    bytes: 'fake-mp4-bytes'.length,
    version: 3,
  })
  expect(settled.detail).toContain('视频已导出')
  const file = join(exportsDir, '让创作回到日常 口播-v3-01234567.mp4')
  expect(existsSync(file)).toBe(true)
  expect(readFileSync(file, 'utf8')).toBe('fake-mp4-bytes')
  // 输入分镜原样传给组合（快照冻结，执行器不改写数据）
  expect(fake.selectComposition.mock.calls[0]![0]).toMatchObject({
    serveUrl: fake.bundleDir,
    id: 'studio-video',
    inputProps: { fps: 30, width: 1080, height: 1920, shots: payload().shots },
  })
  // bundle() 的临时目录渲染后必须清理（spike 坑 4）
  expect(existsSync(fake.bundleDir)).toBe(false)
})

test('进度步骤：帧级进度去重 + 封装阶段提示（真实帧数非伪百分比）', async () => {
  const root = tempDir('export-progress')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    loadApi: async () => fake.api,
  })
  const steps: string[] = []
  const outcome = await executor(exportTaskRecord(), {
    progress: (step) => steps.push(step),
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('complete')
  expect(steps).toEqual([
    '正在打包视频组合…',
    '已渲染 1/540 帧',
    '已渲染 540/540 帧',
    '已渲染 540/540 帧，正在封装…',
  ])
})

test('渲染环境缺失：任务如实失败并给出可理解原因，不触碰渲染器', async () => {
  const root = tempDir('export-missing')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => join(root, 'missing', 'index.tsx'),
    exportsDir: () => join(root, 'exports'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord(), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('failed')
  expect(outcome.detail).toContain('视频渲染组件')
  expect(fake.bundle).not.toHaveBeenCalled()
})

test('分镜数据不完整：入队即失败，不发起渲染', async () => {
  const root = tempDir('export-empty')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord({ payload: payload({ shots: [] }) }), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome).toMatchObject({ state: 'failed' })
  expect(outcome.detail).toContain('分镜')
  expect(fake.bundle).not.toHaveBeenCalled()
})

test('渲染中途取消：任务不得伪 complete，无输出文件，bundle 目录仍清理', async () => {
  const root = tempDir('export-cancel')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root, {
    render: async (options, { emitProgress }) => {
      emitProgress({ renderedFrames: 20, stitchStage: 'encoding' })
      throw new Error('renderMedia() got cancelled')
    },
  })
  const { runner } = makeRunner(
    createExportExecutor({ entryPoint: () => entry, exportsDir: () => join(root, 'exports'), loadApi: async () => fake.api }),
  )
  const settled = await runToSettled(runner, {
    kind: 'export',
    executor: 'main',
    title: '视频导出',
    detail: '正在导出…',
    projectId: 'p1',
    payload: payload(),
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('停止')
  expect(readdirSync(join(root, 'exports'))).toEqual([])
  expect(existsSync(fake.bundleDir)).toBe(false)
})

test('执行器侧中止：ctx.signal abort 时调用渲染器 cancel 并如实结算', async () => {
  const root = tempDir('export-abort')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const controller = new AbortController()
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    loadApi: async () => fake.api,
  })
  const outcomePromise = executor(exportTaskRecord(), {
    progress: () => {},
    signal: controller.signal,
  })
  controller.abort()
  const outcome = await outcomePromise
  expect(outcome.state).toBe('failed')
  expect(outcome.detail).toContain('停止')
  expect(fake.cancel).toHaveBeenCalled()
})

test('渲染器异常：错误信息脱敏（不泄漏本机路径）后如实失败', async () => {
  const root = tempDir('export-error')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root, {
    render: async () => {
      throw new Error(`Cannot find module 'D:\\secret\\path\\module.js'\nstack line 2`)
    },
  })
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord(), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('failed')
  expect(outcome.detail).toContain('视频渲染失败')
  expect(outcome.detail).not.toContain('secret')
})
