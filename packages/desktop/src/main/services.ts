import type {
  DbLoadResult,
  DbSaveResult,
  TaskEvent,
  TaskRecord,
  TaskSettle,
} from '../shared/desktop'
import { migrate, openDatabase } from './storage/db'
import { WorkspaceStore } from './storage/workspace'
import { TaskStore } from './storage/taskStore'
import { TaskRunner, type TaskSubmitInput } from './tasks/runner'

export type ServicesApi = {
  dbLoad(): DbLoadResult
  dbSave(workspace: unknown): DbSaveResult
  taskList(): TaskRecord[]
  taskSubmit(input: TaskSubmitInput): TaskRecord
  taskSettle(id: string, settle: TaskSettle): TaskRecord | null
  taskControl(id: string, action: 'stop' | 'retry'): { ok: boolean }
}

export function initServices(dbPath: string, emit?: (event: TaskEvent) => void) {
  const db = openDatabase(dbPath)
  migrate(db)
  const workspace = new WorkspaceStore(db)
  const runner = new TaskRunner(new TaskStore(db), emit ?? (() => {}))
  const api: ServicesApi = {
    dbLoad() {
      const row = workspace.load()
      return row ? { exists: true, workspace: row.doc } : { exists: false, workspace: null }
    },
    dbSave(doc: unknown): DbSaveResult {
      if (typeof doc !== 'object' || doc === null) return { ok: false, message: '数据写入失败，请重试。' }
      try {
        const at = workspace.save((doc as { schema?: number }).schema ?? 0, doc)
        return { ok: true, at }
      } catch {
        return { ok: false, message: '数据写入失败，请重试；当前内容仍保留在界面中。' }
      }
    },
    taskList: () => runner.list(),
    taskSubmit: (input) => runner.submit(input),
    taskSettle: (id, settle) => runner.settle(id, settle),
    taskControl: (id, action) => runner.control(id, action),
  }
  return { workspace, runner, api, db, close: () => db.close() }
}
