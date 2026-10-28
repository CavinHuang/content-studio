/**
 * P5 视频组合入口（Remotion）：分镜数据驱动的竖屏/横屏口播视频。
 * - 数据形状与取整策略见 src/main/render/composition.ts（三方共享契约，勿在此重复实现）；
 * - 组合 ID、时长（calculateMetadata 按分镜数据计算）、尺寸与帧率全部由 inputProps 决定；
 * - webpack 在运行时由 @remotion/bundler 打包本文件（不进 electron-vite 主 bundle）；
 * - 图片只接受 data URL（渲染端已把内置插画/素材快照冻结进 inputProps）；
 * - 配音（F02）：分镜的 voiceSrc 由主进程解析（mp3 已拷入 bundle 的 public/studio-voice/），
 *   组合用 staticFile 引用——渲染期资源经 renderMedia 的本地 HTTP 服务分发。
 */
import {
  AbsoluteFill,
  Audio,
  Composition,
  Img,
  Sequence,
  interpolate,
  registerRoot,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'
import {
  COMPOSITION_ID,
  shotFrames,
  totalFrames,
  type CompositionShot,
  type StudioVideoProps,
} from '../src/main/render/composition'

const PALETTE = {
  background: '#f5f1e6',
  ink: '#2c3327',
  muted: '#6f7466',
  accent: '#34583b',
  veil: 'rgba(245, 241, 230, 0.9)',
}

const FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", system-ui, sans-serif'

function ShotScene({ shot, index }: { shot: CompositionShot; index: number }) {
  const frame = useCurrentFrame()
  const { durationInFrames, width, height } = useVideoConfig()
  // 入场淡入 / 退场压暗；spike §5 第 5 条：动画关键帧必须 extrapolate: 'clamp'。
  const enter = interpolate(frame, [0, Math.min(10, durationInFrames)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  const exit = interpolate(frame, [Math.max(0, durationInFrames - 8), durationInFrames], [1, 0.4], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  // Ken-Burns 轻推镜：整段 1 → 1.06。
  const zoom = interpolate(frame, [0, durationInFrames], [1, 1.06], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.background, opacity: exit }}>
      {shot.image ? (
        <AbsoluteFill style={{ transform: `scale(${zoom})` }}>
          <Img src={shot.image} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <AbsoluteFill
            style={{
              background:
                'linear-gradient(to top, rgba(245,241,230,0.96) 0%, rgba(245,241,230,0.55) 40%, rgba(245,241,230,0.2) 100%)',
            }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ background: 'linear-gradient(160deg, #f8f4ec 0%, #ebe4d2 100%)' }} />
      )}
      <AbsoluteFill
        style={{
          justifyContent: 'flex-end',
          alignItems: 'flex-start',
          padding: width * 0.08,
          opacity: enter,
          fontFamily: FONT_STACK,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: height * 0.016, maxWidth: '100%' }}>
          <span
            style={{
              color: PALETTE.accent,
              fontSize: width * 0.026,
              letterSpacing: width * 0.008,
              fontWeight: 600,
            }}
          >
            {`镜头 ${String(index + 1).padStart(2, '0')}`}
          </span>
          <h1
            style={{
              color: PALETTE.ink,
              fontSize: width * 0.062,
              lineHeight: 1.3,
              fontWeight: 700,
              margin: 0,
              wordBreak: 'break-word',
            }}
          >
            {shot.title}
          </h1>
          {shot.subtitle ? (
            <span
              style={{
                alignSelf: 'flex-start',
                background: PALETTE.veil,
                color: PALETTE.ink,
                fontSize: width * 0.036,
                lineHeight: 1.6,
                padding: `${height * 0.012}px ${width * 0.03}px`,
                borderRadius: width * 0.02,
                maxWidth: '92%',
              }}
            >
              {shot.subtitle}
            </span>
          ) : null}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  )
}

function StudioVideo(props: StudioVideoProps) {
  const { fps } = useVideoConfig()
  let from = 0
  return (
    <AbsoluteFill style={{ backgroundColor: PALETTE.background }}>
      {props.shots.map((shot, index) => {
        const durationInFrames = shotFrames(shot.durationMs, fps)
        const sequence = (
          <Sequence key={shot.id} from={from} durationInFrames={durationInFrames} name={shot.title}>
            <ShotScene shot={shot} index={index} />
            {shot.voiceSrc ? (
              // F02：配音与画面同轨——Audio 放进镜头 Sequence 内，随镜头起点开始、
              // 在镜头边界被 Sequence 截断（Remotion 语义），无配音分镜完全不受影响。
              // src 必须走 staticFile（public 相对路径）：file:/// 绝对路径会被
              // @remotion/renderer 的资源下载器拒绝（只接受 http(s)），渲染期拿不到音轨。
              <Audio src={staticFile(shot.voiceSrc)} />
            ) : null}
          </Sequence>
        )
        from += durationInFrames
        return sequence
      })}
    </AbsoluteFill>
  )
}

export const RemotionRoot: React.FC = () => (
  <Composition
    id={COMPOSITION_ID}
    component={StudioVideo}
    durationInFrames={90}
    fps={30}
    width={1080}
    height={1920}
    defaultProps={{ fps: 30, width: 1080, height: 1920, shots: [] }}
    calculateMetadata={({ props }) => ({
      fps: props.fps,
      width: props.width,
      height: props.height,
      // 总时长由分镜数据决定（spike §5 实证：selectComposition 返回值与数据算出的帧数一致）。
      durationInFrames: Math.max(1, totalFrames(props.shots, props.fps)),
    })}
  />
)

registerRoot(RemotionRoot)
