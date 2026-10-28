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
  resolveVoiceAssets,
  type RenderApi,
  type VideoExportPayload,
} from '../../packages/desktop/src/main/render/export-job'
import { audioFilePath } from '../../packages/desktop/src/main/render/media-store'

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
    createExportExecutor({
      entryPoint: () => entry,
      exportsDir: () => exportsDir,
      mediaDir: () => join(root, 'media'),
      loadApi: async () => fake.api,
    }),
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
    mediaDir: () => join(root, 'media'),
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
    mediaDir: () => join(root, 'media'),
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
    mediaDir: () => join(root, 'media'),
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
    createExportExecutor({
      entryPoint: () => entry,
      exportsDir: () => join(root, 'exports'),
      mediaDir: () => join(root, 'media'),
      loadApi: async () => fake.api,
    }),
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
    mediaDir: () => join(root, 'media'),
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
    mediaDir: () => join(root, 'media'),
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

test('随包浏览器与渲染根目录：browserExecutable/rootDir/binariesDirectory 进入各渲染调用', async () => {
  const root = tempDir('export-browser')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const browser = join(root, 'chrome-headless-shell', 'chrome-headless-shell.exe')
  const binaries = join(root, 'app.asar.unpacked', 'compositor-win32-x64-msvc')
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => join(root, 'media'),
    loadApi: async () => fake.api,
    browserExecutable: () => browser,
    bundleRootDir: () => root,
    binariesDirectory: () => binaries,
  })
  const outcome = await executor(exportTaskRecord(), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('complete')
  // rootDir：打包形态下 bundler 的 chdir/缓存落点必须是真实目录（asar 内会 ENOENT）。
  expect(fake.bundle.mock.calls[0]![0].rootDir).toBe(root)
  expect(fake.selectComposition.mock.calls[0]![0].browserExecutable).toBe(browser)
  expect(fake.selectComposition.mock.calls[0]![0].binariesDirectory).toBe(binaries)
  expect(fake.renderMedia.mock.calls[0]![0].browserExecutable).toBe(browser)
  expect(fake.renderMedia.mock.calls[0]![0].binariesDirectory).toBe(binaries)
})

test('loadRemotionApi 装配：渲染路径选项缺省为 null 时按 Remotion 默认行为传递', async () => {
  // 不真正加载 Remotion（单测无 Electron 环境）：只验证缺省闭包形态不改变已注入 loadApi 的执行器契约。
  const root = tempDir('export-loadapi')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => join(root, 'media'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord(), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('complete')
  expect(fake.bundle.mock.calls[0]![0].rootDir).toBeNull()
  expect(fake.selectComposition.mock.calls[0]![0].browserExecutable).toBeNull()
  expect(fake.selectComposition.mock.calls[0]![0].binariesDirectory).toBeNull()
  expect(fake.renderMedia.mock.calls[0]![0].browserExecutable).toBeNull()
  expect(fake.renderMedia.mock.calls[0]![0].binariesDirectory).toBeNull()
})

// ─── F02：已生成并保存的配音进入成片音轨 ────────────────────────────────────

const VOICE_ID = '12345678-90ab-4cde-8f12-345678901234'

function voicePayload(over: Partial<VideoExportPayload> = {}): VideoExportPayload {
  return payload({
    shots: [
      { id: 's1', title: '有配音的镜头', voiceAudio: { mediaId: VOICE_ID }, durationMs: 6000 },
      { id: 's2', title: '无配音的镜头', durationMs: 12000 },
    ],
    ...over,
  })
}

test('audioFilePath：合法 UUID → 媒体目录内 mp3 绝对路径；非法引用（目录穿越等）拒绝', () => {
  const dir = join('media', 'dir')
  expect(audioFilePath(dir, VOICE_ID)).toBe(join(dir, `${VOICE_ID}.mp3`))
  expect(audioFilePath(dir, '../../evil')).toBeNull()
  expect(audioFilePath(dir, '')).toBeNull()
  expect(audioFilePath(dir, undefined as unknown as string)).toBeNull()
})

test('resolveVoiceAssets：voiceAudio → voiceSrc；无配音分镜原样透传；同一 mediaId 去重', () => {
  const resolved = resolveVoiceAssets(
    [
      { id: 'a', title: '有配音', durationMs: 1000, voiceAudio: { mediaId: VOICE_ID } },
      { id: 'b', title: '无配音', durationMs: 2000 },
      { id: 'c', title: '复用同一段配音', durationMs: 3000, voiceAudio: { mediaId: VOICE_ID } },
    ],
    join('media'),
    () => true,
  )
  expect(resolved.ok).toBe(true)
  if (!resolved.ok) return
  expect(resolved.shots[0]).toMatchObject({ id: 'a', voiceSrc: `studio-voice/${VOICE_ID}.mp3` })
  expect(resolved.shots[1]).toEqual({ id: 'b', title: '无配音', durationMs: 2000 })
  expect('voiceSrc' in resolved.shots[1]!).toBe(false)
  expect(resolved.shots[2]).toMatchObject({ id: 'c', voiceSrc: `studio-voice/${VOICE_ID}.mp3` })
  expect(resolved.files).toEqual([
    { mediaId: VOICE_ID, absolutePath: join('media', `${VOICE_ID}.mp3`), publicPath: `studio-voice/${VOICE_ID}.mp3` },
  ])
})

test('resolveVoiceAssets：非法引用与音频缺失分别如实失败（不静默出无声成片）', () => {
  const invalid = resolveVoiceAssets(
    [{ id: 'a', title: '镜头甲', durationMs: 1000, voiceAudio: { mediaId: '../evil' } }],
    join('media'),
  )
  expect(invalid).toMatchObject({ ok: false, error: expect.stringContaining('配音引用无效') })
  const missing = resolveVoiceAssets(
    [{ id: 'a', title: '镜头甲', durationMs: 1000, voiceAudio: { mediaId: VOICE_ID } }],
    join('media'),
    () => false,
  )
  expect(missing).toMatchObject({ ok: false, error: expect.stringContaining('配音音频') })
})

test('F02 全链路：配音 mp3 拷入 bundle public/studio-voice，组合 props 携带 voiceSrc', async () => {
  const root = tempDir('export-voice-ok')
  const media = join(root, 'media')
  mkdirSync(media, { recursive: true })
  writeFileSync(join(media, `${VOICE_ID}.mp3`), 'voice-mp3-bytes')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  // bundle 目录在执行器 finally 中被清理：拷贝断言必须在渲染进行中捕获。
  let staged: { exists: boolean; bytes: string | null } = { exists: false, bytes: null }
  let publicDirExisted = true
  const fake = fakeRenderApi(root, {
    render: async (options) => {
      const voiceFile = join(options.serveUrl, 'public', 'studio-voice', `${VOICE_ID}.mp3`)
      staged = { exists: existsSync(voiceFile), bytes: existsSync(voiceFile) ? readFileSync(voiceFile, 'utf8') : null }
      publicDirExisted = existsSync(join(options.serveUrl, 'public'))
      writeFileSync(options.outputLocation, 'fake-mp4-bytes')
    },
  })
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => media,
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord({ payload: voicePayload() }), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('complete')
  // 渲染期内 mp3 已在 bundle 的 public/studio-voice/ 下、字节与媒体目录一致
  expect(staged).toEqual({ exists: true, bytes: 'voice-mp3-bytes' })
  // 组合 props：mediaId → voiceSrc（public 相对路径）；voiceAudio 引用保留，无配音分镜不变
  expect(fake.selectComposition.mock.calls[0]![0].inputProps).toEqual({
    fps: 30,
    width: 1080,
    height: 1920,
    shots: [
      {
        id: 's1',
        title: '有配音的镜头',
        voiceAudio: { mediaId: VOICE_ID },
        voiceSrc: `studio-voice/${VOICE_ID}.mp3`,
        durationMs: 6000,
      },
      { id: 's2', title: '无配音的镜头', durationMs: 12000 },
    ],
  })
})

test('F02 回归：无配音导出行为完全不变（bundle 内不建 public 目录）', async () => {
  const root = tempDir('export-voice-none')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  let publicDirExisted = true
  const fake = fakeRenderApi(root, {
    render: async (options) => {
      publicDirExisted = existsSync(join(options.serveUrl, 'public'))
      writeFileSync(options.outputLocation, 'fake-mp4-bytes')
    },
  })
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => join(root, 'media'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord(), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('complete')
  expect(publicDirExisted).toBe(false)
  expect(fake.selectComposition.mock.calls[0]![0].inputProps).toMatchObject({ shots: payload().shots })
})

test('F02 失败路径：配音音频缺失 → 打包前如实失败，不发起渲染', async () => {
  const root = tempDir('export-voice-missing')
  mkdirSync(join(root, 'media'), { recursive: true }) // 目录在、mp3 不在（如本机清理过媒体目录）
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => join(root, 'media'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(exportTaskRecord({ payload: voicePayload() }), {
    progress: () => {},
    signal: new AbortController().signal,
  })
  expect(outcome.state).toBe('failed')
  expect(outcome.detail).toContain('配音音频')
  expect(fake.bundle).not.toHaveBeenCalled()
})

test('F02 失败路径：非法 mediaId（目录穿越）→ 如实失败，不发起渲染', async () => {
  const root = tempDir('export-voice-invalid')
  const entry = join(root, 'index.tsx')
  writeFileSync(entry, '// entry')
  const fake = fakeRenderApi(root)
  const executor = createExportExecutor({
    entryPoint: () => entry,
    exportsDir: () => join(root, 'exports'),
    mediaDir: () => join(root, 'media'),
    loadApi: async () => fake.api,
  })
  const outcome = await executor(
    exportTaskRecord({
      payload: voicePayload({
        shots: [{ id: 's1', title: '坏的引用', voiceAudio: { mediaId: '..\\evil.mp3' }, durationMs: 6000 }],
      }),
    }),
    { progress: () => {}, signal: new AbortController().signal },
  )
  expect(outcome.state).toBe('failed')
  expect(outcome.detail).toContain('配音引用无效')
  expect(fake.bundle).not.toHaveBeenCalled()
})
