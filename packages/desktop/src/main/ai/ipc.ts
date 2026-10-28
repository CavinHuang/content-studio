import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { AI_CHANNELS } from '../../shared/desktop'
import type { AiHandlers } from './handlers'

export function registerAiHandlers(handlers: AiHandlers, guard: (event: IpcMainInvokeEvent) => void): void {
  ipcMain.handle(AI_CHANNELS.configGet, (event) => {
    guard(event)
    return handlers.configGet()
  })
  ipcMain.handle(AI_CHANNELS.configSet, (event, input: Parameters<AiHandlers['configSet']>[0]) => {
    guard(event)
    return handlers.configSet(input)
  })
  ipcMain.handle(AI_CHANNELS.configClear, (event) => {
    guard(event)
    return handlers.configClear()
  })
  ipcMain.handle(AI_CHANNELS.test, (event, baseUrl: string, apiKey: string, modelId: string) => {
    guard(event)
    return handlers.test(baseUrl, apiKey, modelId)
  })
  ipcMain.handle(AI_CHANNELS.send, (event, sessionKey: string, text: string) => {
    guard(event)
    return handlers.send(sessionKey, text)
  })
  ipcMain.handle(AI_CHANNELS.cancel, (event, sessionKey: string) => {
    guard(event)
    return handlers.cancel(sessionKey)
  })
  ipcMain.handle(AI_CHANNELS.answer, (event, questionId: string, answer: string) => {
    guard(event)
    return handlers.answer(questionId, answer)
  })
}
