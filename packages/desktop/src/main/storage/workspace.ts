import type { DatabaseSync } from 'node:sqlite'

export class WorkspaceStore {
  constructor(private readonly db: DatabaseSync) {}

  load(): { schema: number; doc: unknown } | null {
    const row = this.db.prepare('SELECT schema, json FROM workspace WHERE id = 1').get() as
      | { schema: number; json: string }
      | undefined
    if (!row) return null
    try {
      return { schema: row.schema, doc: JSON.parse(row.json) }
    } catch {
      return null
    }
  }

  save(schema: number, doc: unknown): string {
    if (typeof doc !== 'object' || doc === null) throw new Error('workspace document must be an object')
    const at = new Date().toISOString()
    this.db
      .prepare(
        'INSERT INTO workspace (id, schema, json, updated) VALUES (1, ?, ?, ?) ' +
          'ON CONFLICT(id) DO UPDATE SET schema = excluded.schema, json = excluded.json, updated = excluded.updated',
      )
      .run(schema, JSON.stringify(doc), at)
    return at
  }
}
