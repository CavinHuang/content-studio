# Next.js architecture

```text
Browser → app/(pages) → components/StudioApp.jsx
                     → app/api/[...parts]/route.js (Node runtime)
                         → lib/api.mjs (HTTP status, checks, mapping)
                         → lib/core.mjs (singleton, hot reload safe)
                         → src/*.mjs (V27 unchanged domain services)
                         → node:sqlite data/content-studio.sqlite
```

- Single-process local-only SQLite; not serverless/Edge. `lib/core.mjs` lazy singleton prevents multiple SQLite service instances on Next dev HMR.
- All write requests stay within same-origin localhost. Cross-origin origins and off-device hosts are rejected by default; this is **not** a substitute for authentication. `CONTENT_STUDIO_ALLOW_REMOTE=1` must **not** be used on public servers without adding proper auth, CSRF defense, rate limiting and isolation.
- `lib/api.mjs` preserves the domain payload contracts and status codes of V27; it exposes `/api/health`, `/api/status`, `/api/events`, `/api/briefs`, `/api/sync`, `/api/opportunities`, `/api/validations`, `/api/knowledge`, `/api/precision`, `/api/editor/projects` etc.
- Next.js React frontend controls the current editor revision. Save requires `expectedRevision`, stale revisions yield 409; users must reload/reconcile. Channel revision and moderation checks are separate.
- V27 localStorage-based `/app.html` is retained as migration reference, not synced bidirectionally. Avoid importing it into Next state via automated patching.
- Editor uses paragraphs, not full rich-text blocks; don't claim image, code block and table editing migrated until formal JSON document schema is defined and verified with target platforms.
- AIHOT/GitHub/HN sources remain optional. No demo fixtures loaded unless explicitly enabled. Public API availability and content reuse rights must be checked.
