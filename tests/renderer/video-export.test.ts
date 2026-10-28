import { expect, test } from 'vitest'
import {
  buildExportPayload,
  resolveExportDimensions,
  resolveShotImage,
} from '../../packages/ui/src/studio/video-export'
import { imageDataUrls } from '../../packages/ui/src/studio/images'
import type { Material, Video, VideoVersion } from '../../packages/ui/src/studio/types'

function makeVideo(over: Partial<Video> = {}): Video {
  return {
    id: 'v1',
    title: '让创作回到日常 · 口播',
    mode: 'storyboard',
    source: '母稿',
    ratio: '9:16',
    resolution: '1080 × 1920',
    fps: 30,
    music: '无配乐',
    voice: '自然叙述（Mock）',
    speed: '1.0',
    shots: [
      {
        id: 's1',
        title: '当前编辑中的镜头',
        visual: '',
        narration: '',
        subtitle: '已保存快照里的字幕',
        seconds: 6,
        start: 0,
        end: 6,
        image: 'room',
        voiceDirty: true,
      },
      {
        id: 's2',
        title: '第二镜',
        visual: '',
        narration: '',
        subtitle: '',
        seconds: 12,
        start: 6,
        end: 18,
        image: 'unknown-key',
        voiceDirty: false,
      },
    ],
    brief: '',
    versions: [],
    adopted: 2,
    selectedShot: 's1',
    selectedScene: 0,
    confirmed: true,
    ...over,
  }
}

function makeVersion(over: Partial<VideoVersion> = {}): VideoVersion {
  return {
    number: 2,
    label: '导出前分镜快照',
    title: '让创作回到日常 · 口播',
    color: '#34583b',
    interval: 0.8,
    sceneTitles: ['开场字卡', '三步方法', '结尾收束'],
    at: '2026-10-28T00:00:00Z',
    ...over,
  }
}

const materials: Material[] = [
  {
    id: 'mat-1',
    title: '素材图',
    type: 'image',
    body: '',
    url: '',
    tags: [],
    data: 'data:image/png;base64,QUJD',
    at: '2026-10-28T00:00:00Z',
  },
]

test('resolveExportDimensions：解析分辨率串；非法输入按比例回退', () => {
  expect(resolveExportDimensions('1080 × 1920', '9:16')).toEqual({ width: 1080, height: 1920 })
  expect(resolveExportDimensions('1920 × 1080', '16:9')).toEqual({ width: 1920, height: 1080 })
  expect(resolveExportDimensions('1080 × 1080', '1:1')).toEqual({ width: 1080, height: 1080 })
  expect(resolveExportDimensions('乱码', '9:16')).toEqual({ width: 1080, height: 1920 })
  expect(resolveExportDimensions('乱码', '16:9')).toEqual({ width: 1920, height: 1080 })
  expect(resolveExportDimensions('乱码', '1:1')).toEqual({ width: 1080, height: 1080 })
})

test('resolveShotImage：内置插画内联 data URL；素材图取快照；未知引用退化为纯文字', () => {
  expect(resolveShotImage('room', [])).toBe(imageDataUrls.room)
  expect(resolveShotImage('mat-1', materials)).toBe('data:image/png;base64,QUJD')
  expect(resolveShotImage('unknown-key', materials)).toBeUndefined()
  expect(resolveShotImage(undefined, materials)).toBeUndefined()
})

test('buildExportPayload（storyboard）：用已采用版本的分镜快照，不用当前编辑态', () => {
  const video = makeVideo({
    versions: [
      makeVersion({
        number: 2,
        shots: [
          {
            id: 's1',
            title: '留存快照的镜头标题',
            visual: '',
            narration: '',
            subtitle: '已保存快照里的字幕',
            seconds: 6,
            start: 0,
            end: 6,
            image: 'room',
            voiceDirty: false,
          },
          {
            id: 's2',
            title: '快照第二镜',
            visual: '',
            narration: '',
            subtitle: '',
            seconds: 12,
            start: 6,
            end: 18,
            image: 'unknown-key',
            voiceDirty: false,
          },
        ],
      }),
    ],
  })
  const payload = buildExportPayload(video, materials)
  expect(payload).toMatchObject({ videoId: 'v1', version: 2, fps: 30, width: 1080, height: 1920 })
  // 第一镜来自版本快照（标题与时长），第二镜当前编辑态不同也不受影响
  expect(payload.shots[0]).toMatchObject({
    id: 's1',
    title: '留存快照的镜头标题',
    subtitle: '已保存快照里的字幕',
    image: imageDataUrls.room,
    durationMs: 6000,
  })
  // 未知配图 key → 纯文字分镜（image 缺省），不伪造图片
  expect(payload.shots[1]).toEqual({
    id: 's2',
    title: '快照第二镜',
    durationMs: 12000,
  })
})

test('buildExportPayload（storyboard 无版本快照）：回退当前分镜', () => {
  const video = makeVideo({ versions: [makeVersion({ shots: undefined })] })
  const payload = buildExportPayload(video, [])
  expect(payload.shots[0]).toMatchObject({ title: '当前编辑中的镜头', durationMs: 6000 })
})

test('buildExportPayload：已采用版本快照的配音引用随分镜冻结（F02）', () => {
  const video = makeVideo({
    versions: [
      makeVersion({
        number: 2,
        shots: [
          {
            id: 's1',
            title: '留存快照的镜头标题',
            visual: '',
            narration: '',
            subtitle: '',
            seconds: 6,
            start: 0,
            end: 6,
            image: '',
            voiceDirty: false,
            voiceAudio: { mediaId: '11111111-2222-4333-8444-555555555555', bytes: 1024, at: '2026-10-27T00:00:00Z' },
          },
          {
            id: 's2',
            title: '快照第二镜',
            visual: '',
            narration: '',
            subtitle: '',
            seconds: 12,
            start: 6,
            end: 18,
            image: '',
            voiceDirty: false,
          },
        ],
      }),
    ],
    // 当前编辑态后来换了一段新配音：导出必须用快照里冻结的旧引用，不读编辑态。
    shots: [
      { ...makeVideo().shots[0]!, voiceAudio: { mediaId: '99999999-8888-4777-8666-555555555555', bytes: 2048, at: '2026-10-28T00:00:00Z' } },
      makeVideo().shots[1]!,
    ],
  })
  const payload = buildExportPayload(video, materials)
  expect(payload.shots[0]!.voiceAudio).toEqual({ mediaId: '11111111-2222-4333-8444-555555555555' })
  expect(payload.shots[0]!.voiceAudio).not.toMatchObject({ mediaId: '99999999-8888-4777-8666-555555555555' })
})

test('buildExportPayload：快照无配音时不偷当前编辑态的配音；无配音镜头不产生该字段（F02）', () => {
  const video = makeVideo({
    versions: [
      makeVersion({
        number: 2,
        shots: [
          { ...makeVideo().shots[0]!, voiceDirty: false }, // 快照里没有 voiceAudio
          makeVideo().shots[1]!,
        ],
      }),
    ],
    // 当前编辑态加了配音：快照语义下导出不得携带它
    shots: [
      { ...makeVideo().shots[0]!, voiceAudio: { mediaId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', bytes: 1, at: '2026-10-28T00:00:00Z' } },
      makeVideo().shots[1]!,
    ],
  })
  const payload = buildExportPayload(video, materials)
  expect(payload.shots[0]!.voiceAudio).toBeUndefined()
  expect('voiceAudio' in payload.shots[0]!).toBe(false)
  expect('voiceAudio' in payload.shots[1]!).toBe(false)
})

test('buildExportPayload（code）：当前分镜 + 采用版本的场景标题（与预览一致）', () => {
  const video = makeVideo({
    mode: 'code',
    resolution: '1920 × 1080',
    ratio: '16:9',
    versions: [makeVersion({ sceneTitles: ['一个念头', '慢慢整理'] })],
  })
  const payload = buildExportPayload(video, [])
  expect(payload.width).toBe(1920)
  expect(payload.height).toBe(1080)
  expect(payload.shots.map((s) => s.title)).toEqual(['一个念头', '慢慢整理'])
})

test('buildExportPayload：秒数四舍五入到毫秒，不受浮点误差影响', () => {
  const video = makeVideo({
    shots: [
      {
        id: 's1',
        title: 't',
        visual: '',
        narration: '',
        subtitle: '',
        seconds: 2.5,
        start: 0,
        end: 2.5,
        image: '',
        voiceDirty: false,
      },
    ],
  })
  expect(buildExportPayload(video, []).shots[0]!.durationMs).toBe(2500)
})
