import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

let file: string | null = null

/** 启动黑匣子：打包形态用户无控制台，启动期的每一步与异常落本机日志，供问题定位。 */
export function initStartupLog(userDataDir: string): void {
  try {
    mkdirSync(userDataDir, { recursive: true })
    file = join(userDataDir, 'studio-startup.log')
  } catch {
    file = null
  }
}

function safe(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

export function startupLog(step: string, detail?: unknown): void {
  const line = `[${new Date().toISOString()}] ${step}${detail === undefined ? '' : ` ${safe(detail)}`}\n`
  try {
    if (file) appendFileSync(file, line)
  } catch {
    // 日志失败不影响应用运行。
  }
  if (process.env.STUDIO_SMOKE === '1') process.stdout.write(line)
}
