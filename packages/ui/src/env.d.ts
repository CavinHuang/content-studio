/// <reference types="vite/client" />
import type { DesktopAPI } from '../../desktop/src/shared/desktop'
import type { StudioState } from './studio/types'

declare global {
  interface Window {
    desktop?: DesktopAPI
    /** 测试/开发调试钩子：仅 STUDIO_SMOKE 或 dev 构建挂载。 */
    __studio?: {
      get(): StudioState
      replace(next: StudioState): void
      save(): Promise<void>
      /** 让下一次防抖保存确定性失败一次（验证重试入口）。 */
      __failNextSave(): void
    }
  }
}
