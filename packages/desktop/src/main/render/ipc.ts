import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { VIDEO_CHANNELS } from '../../shared/desktop'
import type { VideoHandlers } from './handlers'

export function registerVideoHandlers(handlers: VideoHandlers, guard: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle(VIDEO_CHANNELS.exportOpenFolder, (event) => {
    guard(event)
    return handlers.exportOpenFolder()
  })
  ipcMain.handle(VIDEO_CHANNELS.ttsConfigGet, (event) => {
    guard(event)
    return handlers.ttsConfigGet()
  })
  ipcMain.handle(VIDEO_CHANNELS.ttsConfigSet, (event, input: Parameters<VideoHandlers['ttsConfigSet']>[0]) => {
    guard(event)
    return handlers.ttsConfigSet(input)
  })
  ipcMain.handle(VIDEO_CHANNELS.ttsConfigClear, (event) => {
    guard(event)
    return handlers.configClear()
  })
  ipcMain.handle(VIDEO_CHANNELS.mediaRead, (event, mediaId: string) => {
    guard(event)
    return handlers.mediaRead(mediaId)
  })
}
