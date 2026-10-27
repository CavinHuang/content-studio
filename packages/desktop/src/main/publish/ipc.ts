import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { PUBLISH_CHANNELS } from '../../shared/desktop'
import type { PublishHandlers } from './handlers'
import type { RedbookHandlers } from './redbook/handlers'

export function registerPublishHandlers(
  handlers: PublishHandlers,
  redbook: RedbookHandlers,
  guard: (event: IpcMainInvokeEvent) => void,
): void {
  ipcMain.handle(PUBLISH_CHANNELS.configGet, (event) => {
    guard(event)
    return handlers.configGet()
  })
  ipcMain.handle(PUBLISH_CHANNELS.configSave, (event, input: Parameters<PublishHandlers['configSave']>[0]) => {
    guard(event)
    return handlers.configSave(input)
  })
  ipcMain.handle(PUBLISH_CHANNELS.configClear, (event) => {
    guard(event)
    return handlers.configClear()
  })
  ipcMain.handle(PUBLISH_CHANNELS.canInject, (event) => {
    guard(event)
    return handlers.canInject()
  })
  ipcMain.handle(PUBLISH_CHANNELS.renderHtml, (event, body: string) => {
    guard(event)
    return handlers.renderHtml(body)
  })
  ipcMain.handle(PUBLISH_CHANNELS.saveDraft, (event, input: Parameters<PublishHandlers['saveDraft']>[0]) => {
    guard(event)
    return handlers.saveDraft(input)
  })
  ipcMain.handle(PUBLISH_CHANNELS.redbookOpenSession, (event) => {
    guard(event)
    return redbook.openSession()
  })
  ipcMain.handle(PUBLISH_CHANNELS.redbookLoginState, (event) => {
    guard(event)
    return redbook.loginState()
  })
  ipcMain.handle(
    PUBLISH_CHANNELS.redbookInjectDraft,
    (event, input: Parameters<RedbookHandlers['injectDraft']>[0]) => {
      guard(event)
      return redbook.injectDraft(input)
    },
  )
}
