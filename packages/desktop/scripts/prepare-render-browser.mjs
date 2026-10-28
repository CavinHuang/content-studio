/**
 * 打包前置：预置 Remotion 渲染所需的 Chrome Headless Shell（P5）。
 * - 背景：@remotion/renderer 首次渲染会按 cwd 就近下载浏览器（spike §7.1），打包后 cwd
 *   不可控且安装目录可能不可写；随包预置 + 运行时 browserExecutable 才能离线导出。
 * - 版本：157.0.8080.0 —— 与 Remotion 4.0.539 自行下载的版本一致（p5-spike-report §1）。
 * - 幂等：目标 exe 已存在即跳过；下载源为 Chrome for Testing 官方存储。
 * 产物：packages/desktop/.render-browser/chrome-headless-shell-win64/（electron-builder
 * extraResources 原样拷入 resources/chrome-headless-shell）。
 */
import { spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '157.0.8080.0'
const DOWNLOAD_URL = `https://storage.googleapis.com/chrome-for-testing-public/${VERSION}/win64/chrome-headless-shell-win64.zip`
const scriptsDir = fileURLToPath(new URL('.', import.meta.url))
const cacheDir = join(scriptsDir, '..', '.render-browser')
const targetExe = join(cacheDir, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe')
const zipPath = join(cacheDir, 'chrome-headless-shell-win64.zip')

if (existsSync(targetExe)) {
  console.log(`[render-browser] already present: ${targetExe}`)
  process.exit(0)
}

mkdirSync(cacheDir, { recursive: true })
console.log(`[render-browser] downloading ${DOWNLOAD_URL}`)
const response = await fetch(DOWNLOAD_URL)
if (!response.ok || !response.body) {
  throw new Error(`Chrome Headless Shell 下载失败：HTTP ${response.status}`)
}
const total = Number(response.headers.get('content-length') ?? 0)
let seen = 0
const file = createWriteStream(zipPath)
for await (const chunk of response.body) {
  seen += chunk.length
  file.write(chunk)
  if (total > 0) process.stdout.write(`\r[render-browser] ${(seen / 1024 / 1024).toFixed(1)}/${(total / 1024 / 1024).toFixed(1)} MB`)
}
await new Promise((resolve) => file.end(resolve))
console.log('')

console.log('[render-browser] extracting…')
// Windows 内置 tar（bsdtar）可解 zip；显式指向系统目录，避免 Git Bash 的 GNU tar。
const tar = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
const extracted = spawnSync(tar, ['-xf', zipPath, '-C', cacheDir], { stdio: 'inherit' })
if (extracted.status !== 0 || !existsSync(targetExe)) {
  rmSync(zipPath, { force: true })
  throw new Error(`Chrome Headless Shell 解压失败（tar 退出码 ${extracted.status}）`)
}
rmSync(zipPath, { force: true })
console.log(`[render-browser] ready: ${targetExe}`)
