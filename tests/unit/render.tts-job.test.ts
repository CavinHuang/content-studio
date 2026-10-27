import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { migrate, openDatabase } from '../../packages/desktop/src/main/storage/db'
import { TaskStore } from '../../packages/desktop/src/main/storage/taskStore'
import { TaskRunner } from '../../packages/desktop/src/main/tasks/runner'
import type { TaskRecord } from '../../packages/desktop/src/shared/desktop'
import { createVoiceExecutor } from '../../packages/desktop/src/main/render/tts-job'
import { readAudio } from '../../packages/desktop/src/main/render/media-store'
import type { TtsConfig } from '../../packages/desktop/src/main/render/tts-config'

let server: Server
let base = ''
let db: DatabaseSync | undefined
const tempDirs: string[] = []

type SpeechSeen = { auth: string | undefined; body: Record<string, unknown> }
let speechCalls: SpeechSeen[] = []
let speechStatus = 200
let speechBytes = Buffer.from('fake-mp3-audio-bytes')

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(chunk as Buffer))
    req.on('end', () => {
      if (req.url === '/audio/speech') {
        speechCalls.push({
          auth: req.headers.authorization,
          body: JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>,
        })
        if (speechStatus !== 200) {
          res.statusCode = speechStatus
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: { message: 'voice not found' } }))
          return
        }
        res.setHeader('content-type', 'audio/mpeg')
        res.end(speechBytes)
        return
      }
      res.statusCode = 404
      res.end()
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
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

const CONFIG: TtsConfig = {
  baseUrl: 'http://registry.invalid/v1',
  apiKey: 'sk-voice-1234',
  modelId: 'tts-large',
  voice: 'alloy',
}

function makeRunner(config: TtsConfig | null) {
  db = openDatabase(join(tempDir('tts-runner'), 'studio.db'))
  migrate(db)
  const events: TaskRecord[] = []
  const runner = new TaskRunner(new TaskStore(db), (event) => {
    if (event.type === 'updated') events.push(event.task)
  })
  const mediaRoot = tempDir('tts-media')
  runner.registerExecutor(
    'voice',
    createVoiceExecutor({
      getConfig: () => config,
      mediaDir: () => join(mediaRoot, 'media'),
      baseUrl: base, // e2e/单测 stub：覆盖配置里的官方地址
    }),
  )
  return { runner, events, mediaRoot }
}

async function runToSettled(runner: TaskRunner, submit: Parameters<TaskRunner['submit']>[0]): Promise<TaskRecord> {
  const task = runner.submit(submit)
  for (let i = 0; i < 200 && runner.get(task.id)!.state === 'running'; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  return runner.get(task.id)!
}

test('生成成功：请求形状（Bearer/模型/音色/语速/mp3）、音频落盘、结果可回读', async () => {
  speechCalls = []
  const { runner, mediaRoot } = makeRunner(CONFIG)
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '正在生成配音…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 'shot-2', text: '把想法写成一篇作品。', speed: 0.8 },
  })
  expect(settled.state).toBe('complete')
  expect(settled.detail).toContain('配音已生成')
  // 请求形状：OpenAI 兼容 /audio/speech
  expect(speechCalls).toHaveLength(1)
  expect(speechCalls[0]!.auth).toBe('Bearer sk-voice-1234')
  expect(speechCalls[0]!.body).toEqual({
    model: 'tts-large',
    input: '把想法写成一篇作品。',
    voice: 'alloy',
    speed: 0.8,
    response_format: 'mp3',
  })
  // 音频真实落盘并可按 mediaId 回读（渲染端试听/测时长用）
  const result = settled.result as { mediaId: string; fileName: string; bytes: number; mime: string }
  expect(result.bytes).toBe(speechBytes.length)
  expect(result.mime).toBe('audio/mpeg')
  const file = join(mediaRoot, 'media', result.fileName)
  expect(existsSync(file)).toBe(true)
  expect(readFileSync(file).equals(speechBytes)).toBe(true)
  const read = readAudio(join(mediaRoot, 'media'), result.mediaId)
  expect(read && read.data.equals(speechBytes)).toBe(true)
  expect(read?.mime).toBe('audio/mpeg')
})

test('语速 1.0 不传 speed 字段（服务端默认值）', async () => {
  speechCalls = []
  const { runner } = makeRunner(CONFIG)
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 's1', text: '正常语速。' },
  })
  expect(settled.state).toBe('complete')
  expect(speechCalls[0]!.body).not.toHaveProperty('speed')
})

test('未配置语音服务：如实失败，不发出任何请求', async () => {
  speechCalls = []
  const { runner } = makeRunner(null)
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 's1', text: '口播' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('尚未配置语音服务')
  expect(speechCalls).toHaveLength(0)
})

test('空口播文案：入队即失败，不发出请求', async () => {
  speechCalls = []
  const { runner } = makeRunner(CONFIG)
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 's1', text: '  ' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('口播文案')
  expect(speechCalls).toHaveLength(0)
})

test('服务端错误（音色不存在）：失败信息带状态码与服务端消息', async () => {
  speechCalls = []
  speechStatus = 422
  const { runner } = makeRunner(CONFIG)
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 's1', text: '口播' },
  })
  speechStatus = 200
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('422')
  expect(settled.detail).toContain('voice not found')
})

test('网络不可达：如实失败并提示检查网络，不伪装成功', async () => {
  db = openDatabase(join(tempDir('tts-net'), 'studio.db'))
  migrate(db)
  const runner = new TaskRunner(new TaskStore(db), () => {})
  const mediaRoot = tempDir('tts-media-net')
  runner.registerExecutor(
    'voice',
    createVoiceExecutor({ getConfig: () => CONFIG, mediaDir: () => join(mediaRoot, 'media'), baseUrl: 'http://127.0.0.1:1' }),
  )
  const settled = await runToSettled(runner, {
    kind: 'voice',
    executor: 'main',
    title: '更新所选镜头配音',
    detail: '…',
    projectId: 'p1',
    payload: { job: 'shot-voice', shotId: 's1', text: '口播' },
  })
  expect(settled.state).toBe('failed')
  expect(settled.detail).toContain('无法连接语音服务')
})

test('mediaId 严格校验：目录穿越与非法 ID 一律返回 null', () => {
  const dir = tempDir('tts-read')
  expect(readAudio(dir, '../../etc/passwd')).toBeNull()
  expect(readAudio(dir, 'not-a-uuid')).toBeNull()
  expect(readAudio(dir, '')).toBeNull()
})
