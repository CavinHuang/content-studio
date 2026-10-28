/**
 * F02 组合映射单测：Remotion 组合按分镜的 voiceSrc 用 <Audio> 合成音轨。
 * remotion 运行时（AbsoluteFill/Sequence 等）依赖组合注册环境，这里以 vi.mock 注入
 * 轻量替身——只验证映射契约本身：voiceSrc → staticFile → <Audio src>，无配音分镜
 * 不产生音频元素；组件从 <Composition component> 捕获，不依赖真实渲染器。
 */
import { act } from 'react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, test, vi } from 'vitest'
import type { StudioVideoProps } from '../../packages/desktop/src/main/render/composition'

const mocks = vi.hoisted(() => ({
  audioProps: [] as Array<{ src: string }>,
  compositionComponent: null as ((props: StudioVideoProps) => ReactNode) | null,
  defaultProps: null as StudioVideoProps | null,
}))

vi.mock('remotion', () => ({
  AbsoluteFill: (props: { children?: ReactNode }) => props.children ?? null,
  Audio: (props: { src: string }) => {
    mocks.audioProps.push(props)
    return null
  },
  Composition: (props: {
    component: (p: StudioVideoProps) => ReactNode
    defaultProps: StudioVideoProps
  }) => {
    mocks.compositionComponent = props.component
    mocks.defaultProps = props.defaultProps
    return null
  },
  Img: () => null,
  Sequence: (props: { children?: ReactNode; from: number; durationInFrames: number }) =>
    props.children ?? null,
  interpolate: () => 1,
  registerRoot: () => undefined,
  staticFile: (path: string) => `/public/${path}`,
  useCurrentFrame: () => 0,
  useVideoConfig: () => ({ fps: 30, durationInFrames: 90, width: 1080, height: 1920 }),
}))

// vi.mock 会被提升到所有 import 之前，这里拿到的是注入替身后的组合入口。
import { RemotionRoot } from '../../packages/desktop/remotion/index'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const VOICE_ID = '12345678-90ab-4cde-8f12-345678901234'

function renderRoot() {
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => {
    root.render(createElement(RemotionRoot))
  })
  root.unmount()
}

function mount(props: StudioVideoProps) {
  renderRoot() // 渲染组合入口 → Composition 替身捕获 StudioVideo 与缺省 props
  const component = mocks.compositionComponent
  if (!component) throw new Error('组合组件未被捕获')
  const container = document.createElement('div')
  const root = createRoot(container)
  act(() => {
    root.render(createElement(component, props))
  })
  root.unmount()
}

afterEach(() => {
  mocks.audioProps.splice(0)
})

test('组合映射：voiceSrc → staticFile → <Audio>，无配音分镜不产生音频元素（F02）', () => {
  mount({
    fps: 30,
    width: 1080,
    height: 1920,
    shots: [
      { id: 's1', title: '有配音', durationMs: 6000, voiceSrc: `studio-voice/${VOICE_ID}.mp3` },
      { id: 's2', title: '无配音', durationMs: 12000 },
    ],
  })
  // src 必须经过 staticFile（bundle 渲染环境解析为 /public/… 供本地 HTTP 服务分发），
  // 而不是原始相对路径或 file:/// 绝对路径（渲染器资源下载器只接受 http(s)）。
  expect(mocks.audioProps).toEqual([{ src: `/public/studio-voice/${VOICE_ID}.mp3` }])
})

test('组合映射：全部无配音（旧快照/无字段）时组合不注册任何音频（行为不变）', () => {
  mount({
    fps: 30,
    width: 1080,
    height: 1920,
    shots: [
      { id: 's1', title: '甲', durationMs: 3000 },
      { id: 's2', title: '乙', durationMs: 3000 },
    ],
  })
  expect(mocks.audioProps).toEqual([])
})

test('组合缺省 props（无分镜）：不注册音频，组合入口可独立加载', () => {
  renderRoot()
  expect(mocks.defaultProps).toMatchObject({ fps: 30, width: 1080, height: 1920, shots: [] })
  expect(mocks.audioProps).toEqual([])
})

test('组合映射：多镜头各自带配音 → 逐镜头各一个 <Audio>（同一 Sequence 时间线）', () => {
  const other = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
  mount({
    fps: 30,
    width: 1080,
    height: 1920,
    shots: [
      { id: 's1', title: '甲', durationMs: 3000, voiceSrc: `studio-voice/${VOICE_ID}.mp3` },
      { id: 's2', title: '乙', durationMs: 3000, voiceSrc: `studio-voice/${other}.mp3` },
    ],
  })
  expect(mocks.audioProps).toEqual([
    { src: `/public/studio-voice/${VOICE_ID}.mp3` },
    { src: `/public/studio-voice/${other}.mp3` },
  ])
})
