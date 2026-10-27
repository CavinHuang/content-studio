/// <reference types="vite/client" />
import type { DesktopAPI } from '../../desktop/src/shared/desktop'

declare global {
  interface Window {
    desktop?: DesktopAPI
  }
}
