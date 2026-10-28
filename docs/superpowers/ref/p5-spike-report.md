# P5 Spike 报告：Windows 本机 Remotion 渲染链验证

- 日期：2026-10-28
- 分支：`feat/real-foundation`
- 结论：**可行（viable ✅）**。本机（win32-x64，AMD Ryzen 5 7600X，12 逻辑核，Node v24.1.0，pnpm 11.25.0）完整跑通 安装 → bundle → renderMedia(h264) → 取消 → 分镜数据驱动。以下所有数字均来自本次真实运行（探针脚本位于本地 `spikes/p5-remotion/`，已用 `.git/info/exclude` 排除出 git，未入库）。

## 1. 版本与安装事实

| 项 | 值 |
| --- | --- |
| remotion / @remotion/renderer / @remotion/bundler | **4.0.539**（三者必须同版本） |
| react（peer，由仓库侧提供） | 19.3.1 |
| esbuild（传递依赖，唯一带构建脚本者） | 0.28.1 |
| 原生合成器 | @remotion/compositor-win32-x64-msvc 4.0.539，自带 `remotion.exe` / `ffmpeg.exe` / `ffprobe.exe`，**无需系统 FFmpeg** |
| 浏览器 | Chrome Headless Shell 157.0.8080.0 win64（Remotion 自动下载） |

安装要点：

1. **renderMedia 不能只装 @remotion/renderer**：程序化渲染必须先用 `@remotion/bundler` 的 `bundle()` 产出 `serveUrl`。P5 落地时三个包都要进依赖。
2. **allowBuilds 裁决**：pnpm 提示 `Ignored build scripts: esbuild@0.28.1`。仓库根 `pnpm-workspace.yaml` 已有 `esbuild: true`，产品工作区无需新增裁决；本 spike 在独立目录里同样显式裁决 `esbuild: true` 后重装，postinstall 正常执行。
3. **pnpm 11 供应链策略（真实踩坑）**：本环境启用 `minimumReleaseAge`，首次解析命中 3 个发布未满冷却期的传递依赖（browserslist 4.29.5、electron-to-chromium 1.5.465、postcss 8.5.32）直接失败（`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`）。解法：`pnpm clean --lockfile` 重建解析后重装即通过。P5 真实引入依赖时若再遇到，同法处理，不要绕过策略。
4. 无害警告：webpack 5.105 与 schema-utils 4.8.1 的 peer 提示（bundler 内部传递依赖，不影响功能）。

## 2. 渲染性能（真实测量）

最小组合：1080×1920、30fps、90 帧（3 秒），纯文本 + 色块动画，h264 MP4。

| 阶段 | 首次运行 | 复跑（热） |
| --- | --- | --- |
| Chrome Headless Shell 下载 | 24.4s（120.1 MB） | 0.001s（已缓存） |
| bundle（webpack） | 9.10s | 1.69s |
| **renderMedia 90 帧** | **3.879s** | **3.526s** |
| 产物大小 | 144,033 字节 | 同（确定性输出） |

- ffprobe（用 Remotion 自带 ffprobe）验证产物：`h264 / 1080×1920 / r_frame_rate 30/1 / nb_frames 90 / duration 3.000000` —— 内容真实有效。
- 渲染吞吐 ≈ 25 帧/秒（简单内容、默认并发、12 逻辑核）。首帧渲染前约 0.9s 是浏览器页面启动开销。
- 未显式设置 `concurrency`，使用 Remotion 默认。

## 3. 进度回调：真实帧级进度 ✅

`onProgress` 共回调 **94 次**，`RenderMediaProgress` 结构（源码 `render-media.d.ts:28`）：

```ts
{ renderedFrames, encodedFrames, encodedDoneIn, renderedDoneIn,
  renderEstimatedTime, progress, stitchStage: 'encoding' | 'muxing' }
```

实测采样（复跑）：`t=941ms → 1 帧`、`t=1893ms → 47 帧`、`t=3435ms → 90 帧(编码完成)`。验证项：

- `renderedFrames` **单调不减** ✅
- 最终值**恰好等于总帧数 90** ✅，`stitchStage` 经历 `encoding → muxing` ✅

结论：这是真实帧计数与真实编码阶段，可直接换算「已渲染帧/总帧」做进度条，不需要伪百分比。若要 ETA，可用 `renderEstimatedTime` 或自行按帧率换算。

## 4. 取消验证 ✅

方案：`makeCancelSignal()` 生成 `{cancelSignal, cancel}`，`renderMedia({cancelSignal})` 渲染 900 帧长片，`renderedFrames ≥ 20` 时调用 `cancel()`：

| 检查项 | 结果 |
| --- | --- |
| cancel() → promise reject 延迟 | **2ms**（立即） |
| reject 内容 | `Error: renderMedia() got cancelled` |
| 残留进程（chrome-headless-shell / remotion.exe / ffmpeg） | 无（1.5s 后 tasklist 核对，与基线一致） |
| 部分写出 MP4 | 未产生（outputLocation 无文件） |
| %TEMP% 残留 | 一次 4KB 的 `remotion-v4.0.539-assets*` 目录残留（见坑 6） |

## 5. 分镜数据驱动可行性要点 ✅

实测代码路径（全部跑通并渲染出片）：

1. **props 驱动结构**：`ShotsProps = {shots: [{id, title, subtitle?, image?, durationMs}]}`，组件内 `shots.map()` 生成 `<Sequence from={累计帧} durationInFrames={shotFrames(durationMs, fps)}>`；Sequence 内 `useCurrentFrame()` 是分镜相对帧、`useVideoConfig().durationInFrames` 是该分镜帧长——做分镜内入出动画非常顺手。
2. **时长随数据变化**：`<Composition calculateMetadata={({props}) => ({durationInFrames: totalFrames(props.shots, 30)})}>`。**实测**：用外部 inputProps（2 个分镜 1200ms+1800ms）调 `selectComposition()`，返回 `durationInFrames=90`，与数据算出的期望值完全一致——总时长由数据决定，不是编译期常量。
3. **图片素材**：`public/` 目录 + `staticFile('shot.png')` + `<Img>`，`bundle({publicDir})` 显式指定；图片分镜正常渲染（含 Ken-Burns 式缩放）。
4. **渲染结果**：数据驱动组合 3.349s 渲染完成，178,074 字节，ffprobe 验证 1080×1920 / 90 帧 / 3.000s。
5. **产品侧需自定的规则**：`durationMs → 帧` 的取整策略（本 spike 用 `Math.round(ms/1000*fps)`，最短 1 帧钳制）；分镜极短时的动画关键帧钳制（`extrapolate: 'clamp'` 必加）。

## 6. 网络需求

| 场景 | 需要网络 |
| --- | --- |
| `pnpm install` | 是（npmmirror 镜像偶发 `UND_ERR_DESTROYED` 重试，可自愈） |
| 首次渲染（下载 Chrome Headless Shell 120.1MB） | 是：`remotion.dev`（版本发现）+ `storage.googleapis.com/chrome-for-testing-public/...`（下载） |
| 之后所有渲染 | **否**（浏览器缓存在 `node_modules/.remotion/`，磁盘占用 283MB） |

离线回退（未实测渲染，仅确认存在路径）：`renderMedia({browserExecutable})` 可指向本机已有 Chromium（如 Playwright 的 `%LOCALAPPDATA%/ms-playwright/chromium-*/chrome-win/chrome.exe`）或 Edge，跳过下载。

## 7. 坑清单

1. **浏览器缓存目录取决于 cwd**（源码 `get-download-destination.js`）：从 cwd 向上找最近 `package.json`，把浏览器放在其下 `node_modules/.remotion/`。对打包后的 Electron 应用，cwd 不可控 → 必须显式管理（预置浏览器或传 `browserExecutable`）。
2. **ESM 具名导入报错**：`import {isUserCancelledRender} from '@remotion/renderer'` 直接 `SyntaxError`（CJS 词法分析限制）。稳妥写法：`import * as m from '@remotion/renderer'; const {renderMedia} = m.default ?? m;`
3. **d.ts 与实现不一致**：`isUserCancelledRender` 在 `index.d.ts` 有声明，但 CJS 根导出缺失（实测 `typeof undefined`）。按官方固定文案 `got cancelled` 判定取消即可。
4. **bundle 产物不自动清理**：`bundle()` 默认在 `%TEMP%` 建 `remotion-webpack-bundle-*`（实测每个约 34MB），不会删除。产品代码渲染完必须 `fs.rm(serveUrl, {recursive: true, force: true})`，否则临时盘会被吃满。
5. **供应链策略**：见第 1 节第 3 条，`minimumReleaseAge` 会拒绝刚发布的传递依赖，属预期行为，重建 lockfile 解决。
6. **%TEMP% 中 `remotion-v4.0.539-assets*` 目录**：渲染过程的资源目录，成功渲染后随进程退出清理（观测到异步消失），取消场景观测到一次 4KB 残留。量级小，但产品可加定期清扫兜底。
7. **license 提示**：Remotion 4.0.539 为 AGPL/商业双许可（公司闭源商用需注意，本仓库内用 AGPL 合规或购买许可；与「WeSight/gzh-design 只借鉴思路」的既有铁律同类，代码层面零复制）。

## 8. 对 P5 落地的最小接线建议

```ts
// 渲染管线骨架（已在本 spike 全链路验证）
import * as bundlerMod from '@remotion/bundler';
import * as rendererMod from '@remotion/renderer';
const {bundle} = bundlerMod.default ?? bundlerMod;
const {renderMedia, selectComposition, makeCancelSignal} = rendererMod.default ?? rendererMod;

const serveUrl = await bundle({entryPoint, publicDir});       // 产物要自己清理
const composition = await selectComposition({serveUrl, id, inputProps: {shots}}); // 时长随 shots 变化
const {cancelSignal, cancel} = makeCancelSignal();            // 用户点「取消」时调 cancel()
await renderMedia({composition, serveUrl, codec: 'h264', outputLocation,
                   inputProps: {shots}, cancelSignal,
                   onProgress: (p) => report(p.renderedFrames / composition.durationInFrames)});
```

- 进度直接用真实帧数，任务中心可显示「已渲染 N/总帧」。
- 取消按钮 → `cancel()`，实测 2ms 内停止、无残留进程、无部分文件。
