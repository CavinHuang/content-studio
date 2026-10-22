# PROVENANCE — vendored ZJU-REAL/Easel source

本目录是 [ZJU-REAL/Easel](https://github.com/ZJU-REAL/Easel) 上游源码的**只读参考副本**，用于本仓库 Easel 式改造的参考与适配源。除本文件外，`vendor/easel/` 下所有内容均原样来自上游 commit，未做任何修改。

## 来源

| 项 | 值 |
| --- | --- |
| 来源仓库 | https://github.com/ZJU-REAL/Easel |
| 来源 ref | `main` |
| 来源 commit SHA | `3f1d4fb8b99694f7231ee97163b637df89b50d3b`（2026-10-21T06:46:03Z，"fix: default tool budgets to unlimited and validate video checkpoints"） |
| 下载方式 | `gh api repos/ZJU-REAL/Easel/tarball/main`（降级链方式 a 一步成功，未使用 curl / 逐文件回退） |
| 下载日期 | 2026-10-22 |
| 上游许可证 | **Apache-2.0**（原文保留于本目录 `LICENSE`；上游无单独 NOTICE 文件） |

## 搬运范围

- `web/` — FastAPI + React 前端（剔除大体积 showcase 视频与超限图片，见下）
- `easel/` — Python CLI
- `docs/`
- `skills/` — `skills/builtin/` 下除 `gzh-design` 外的全部技能 + `skills/shared/`
- 根目录小文件：`README.md`、`README_EN.md`、`LICENSE`、`CHANGELOG.md`、`CONTRIBUTING.md`、`WECHAT_OA_INTEGRATION.md`、`pyproject.toml`、`pytest.ini`、`conftest.py`、`setup.sh`、`setup.ps1`、`PSScriptAnalyzerSettings.psd1`、`.gitignore`

落盘规则：`vendor/easel/<上游原路径>`，共 842 个文件，约 **13.75 MB**（上限 30MB）。

## 排除清单与理由

1. **`skills/builtin/gzh-design/` — AGPL-3.0，一个文件都未搬入。** 该子目录上游许可证与仓库主体 Apache-2.0 不同，为避免许可证传染，81 个文件（约 1.38 MB）全部排除。已核验 vendor 树中不存在任何 `gzh-design` 路径。
2. **`.env*`** — 上游 `​.env.example`（根目录）与 `skills/builtin/ecom-details-image/.env.example` 共 2 个文件按红线排除。
3. **单文件 > 512KB 的非源码资产（12 个，约 205.5 MB）** — 按红线跳过：
   - `web/static/showcase/full/cyber-cultivation.mp4`（57.2MB）
   - `web/static/showcase/full/emotion-recycle.mp4`（46.9MB）
   - `web/static/showcase/full/hanako-change.mp4`（43.2MB）
   - `web/static/showcase/full/kisaragi-station.mp4`（20.3MB）
   - `web/static/showcase/culture-mt-explainer.mp4`（12.2MB）
   - `web/static/showcase/spatialladder-explainer.mp4`（11.2MB）
   - `web/static/showcase/full/daomu-book.mp4`（6.3MB）
   - `skills/builtin/video-production/vendor/video-pipeline-sdk/assets/fonts/MaShanZheng-Regular.ttf`（5.9MB，字体）
   - `web/static/showcase/full/jilong-news.mp4`（4.1MB）
   - `web/static/showcase/full/zju-intro.mp4`（3.3MB）
   - `web/static/showcase/spatialevo-cards-strip.jpg`（0.58MB）
   - `web/static/showcase/knowu-cards-strip.jpg`（0.57MB）
4. **不在包含清单中的顶层目录** — `agents/`、`assets/`（247MB 媒体库）、`outputs/`、`profiles/`、`scripts/`、`tests/`、`.github/` 均未搬入；如后续适配需要可按同一 provenance 规则补充。

## 本仓库对它的使用方式

- **仅供参考与适配源**：作为 Easel 交互/架构的阅读材料与移植对照，不参与本仓库的构建、测试或运行时。
- **Python 部分不在 Node 运行时执行**：`easel/`（Python CLI）与 `web/app.py`（FastAPI）只是阅读/适配源，本仓库 Next.js 运行时不会调用、安装或执行它们。
- 上游 `.gitignore` 原样保留在本目录下；已核验其对 vendor 内已跟踪文件无影响（无被其规则命中的在库文件）。
- 更新本目录时必须同步更新本文件（新 commit SHA、新排除项）。
