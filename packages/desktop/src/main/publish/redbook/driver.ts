import type { RedbookPayload, RedbookResult } from './inject-script'

/**
 * 小红书平台会话驱动：主进程 RedbookSession 实现；执行器与服务经此接口解耦（单测用假驱动，不依赖 Electron）。
 */
export type RedbookDriver = {
  /** 打开平台页：visible=true 挂主窗口右半屏可见；false 零尺寸隐藏（仅登录探测/后台注入）。 */
  open(visible: boolean): Promise<void>
  /** 在平台页执行自包含注入脚本负载（loginCheck/inject/readBack）。 */
  evaluate(payload: RedbookPayload): Promise<RedbookResult>
}
