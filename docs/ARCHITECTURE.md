# Next.js architecture

```text
Browser → app/(pages) → CreatorShell / Creator* / WritingWorkspace
                     → app/api/[...parts]/route.js (Node runtime)
                         → lib/api.mjs (HTTP status, checks, mapping)
                         → lib/core.mjs (local core or authenticated per-author core)
                         → src/*.mjs (creator + original evidence/revision services)
                         → SQLite WAL: local DB or private workspace DB
```

- Single-process local-only SQLite; not serverless/Edge. `lib/core.mjs` lazy singleton prevents multiple SQLite service instances on Next dev HMR.
- All write requests stay within same-origin localhost. Cross-origin origins and off-device hosts are rejected by default; this is **not** a substitute for authentication. `CONTENT_STUDIO_ALLOW_REMOTE=1` must **not** be used on public servers without adding proper auth, CSRF defense, rate limiting and isolation.
- `lib/api.mjs` preserves the domain payload contracts and status codes of V27; it exposes `/api/health`, `/api/status`, `/api/events`, `/api/briefs`, `/api/sync`, `/api/opportunities`, `/api/validations`, `/api/knowledge`, `/api/precision`, `/api/editor/projects` etc.
- Next.js React frontend controls the current editor revision. Save requires `expectedRevision`, stale revisions yield 409; users must reload/reconcile. Channel revision and moderation checks are separate.
- V27 localStorage-based `/app.html` is retained as migration reference, not synced bidirectionally. Avoid importing it into Next state via automated patching.
- Integrated `/compose` uses doocs editing/rendering modules, `src/writing.mjs`, and a Markdown sidecar keyed by the existing reference/revision. Markdown is authoritative in this mode; paragraph records are a same-transaction evidence projection. Legacy paragraph/layout writers reject migrated documents. See [writing workspace](WRITING-WORKSPACE.md) for migration and platform limits.
- AIHOT/GitHub/HN sources remain optional. No demo fixtures loaded unless explicitly enabled. Public API availability and content reuse rights must be checked.

## V1 creator services

`author-accounts` validates opaque sessions before core selection. Database-per-workspace isolation applies to every legacy endpoint as well as creator APIs. `creator-services` encrypts connections and supplies request-local provider configuration via AsyncLocalStorage; it never mutates process credentials. `creator` owns profiles, sources, topics, series, asset references/search and metrics; `creator-worker` schedules persisted jobs through Next instrumentation. `xiaohongshu` owns actual PNG groups and revision-bound reviews; `publishing` owns encrypted accounts, account-specific media, idempotent operations and separate delivery facts.

Historical article references pin source revisions. Markdown and image assets remain in the existing editorial/asset model; the library is a derived view, not a competing content store. FTS5 adds WITHOUT ROWID shadow tables, which V45/V47 preservation checks now audit by primary key without excluding their contents. See [CREATOR-V1.md](CREATOR-V1.md).
