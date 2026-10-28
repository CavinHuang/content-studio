import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { DISCOVERY_CHANNELS } from '../../shared/desktop'
import type { DiscoveryHandlers } from './handlers'

export function registerDiscoveryHandlers(
  handlers: DiscoveryHandlers,
  guard: (event: IpcMainInvokeEvent) => void,
): void {
  ipcMain.handle(DISCOVERY_CHANNELS.snapshot, (event) => {
    guard(event)
    return handlers.snapshot()
  })
  ipcMain.handle(DISCOVERY_CHANNELS.sourceList, (event) => {
    guard(event)
    return handlers.sourceList()
  })
  ipcMain.handle(DISCOVERY_CHANNELS.sourceSave, (event, input: Parameters<DiscoveryHandlers['sourceSave']>[0]) => {
    guard(event)
    return handlers.sourceSave(input)
  })
  ipcMain.handle(DISCOVERY_CHANNELS.sourceDelete, (event, id: string) => {
    guard(event)
    return handlers.sourceDelete(id)
  })
  ipcMain.handle(DISCOVERY_CHANNELS.sourceRefresh, (event, id: string) => {
    guard(event)
    return handlers.sourceRefresh(id)
  })
  ipcMain.handle(DISCOVERY_CHANNELS.refreshAll, (event) => {
    guard(event)
    return handlers.refreshAll()
  })
}
