import type { DatabaseSync } from 'node:sqlite'
import type { TaskRecord } from '../../shared/desktop'

type TaskRow = {
  id: string
  title: string
  detail: string
  projectId: string
  kind: string
  state: string
  at: string
  updated: string
  progress: string | null
  error: string | null
  payloadJson: string | null
  resultJson: string | null
  extraJson: string | null
}

const COLUMNS =
  'id, title, detail, projectId, kind, state, at, updated, progress, error, payloadJson, resultJson, extraJson'

function toRecord(row: TaskRow): TaskRecord {
  const record: TaskRecord = {
    id: row.id,
    title: row.title,
    detail: row.detail,
    projectId: row.projectId,
    kind: row.kind,
    state: row.state as TaskRecord['state'],
    at: row.at,
    updated: row.updated,
  }
  if (row.progress) record.progress = row.progress
  if (row.error) record.error = row.error
  if (row.payloadJson) record.payload = JSON.parse(row.payloadJson)
  if (row.resultJson) record.result = JSON.parse(row.resultJson)
  if (row.extraJson) record.extra = JSON.parse(row.extraJson)
  return record
}

export class TaskStore {
  constructor(private readonly db: DatabaseSync) {}

  list(): TaskRecord[] {
    const rows = this.db.prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY at DESC`).all() as TaskRow[]
    return rows.map(toRecord)
  }

  get(id: string): TaskRecord | null {
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`).get(id) as TaskRow | undefined
    return row ? toRecord(row) : null
  }

  insert(record: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO tasks (${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.title,
        record.detail,
        record.projectId,
        record.kind,
        record.state,
        record.at,
        record.updated,
        record.progress ?? null,
        record.error ?? null,
        record.payload === undefined ? null : JSON.stringify(record.payload),
        record.result === undefined ? null : JSON.stringify(record.result),
        record.extra === undefined ? null : JSON.stringify(record.extra),
      )
  }

  patch(id: string, fields: Partial<TaskRecord>): TaskRecord | null {
    const current = this.get(id)
    if (!current) return null
    const next = { ...current, ...fields, updated: new Date().toISOString() }
    this.db
      .prepare(
        'UPDATE tasks SET title = ?, detail = ?, state = ?, updated = ?, progress = ?, error = ?, ' +
          'payloadJson = ?, resultJson = ?, extraJson = ? WHERE id = ?',
      )
      .run(
        next.title,
        next.detail,
        next.state,
        next.updated,
        next.progress ?? null,
        next.error ?? null,
        next.payload === undefined ? null : JSON.stringify(next.payload),
        next.result === undefined ? null : JSON.stringify(next.result),
        next.extra === undefined ? null : JSON.stringify(next.extra),
        id,
      )
    return this.get(id)
  }

  stopActive(detail: string): TaskRecord[] {
    const affected = this.list().filter((t) => t.state === 'queued' || t.state === 'running')
    for (const task of affected) this.patch(task.id, { state: 'stopped', detail })
    return affected.map((t) => this.get(t.id)!)
  }
}
