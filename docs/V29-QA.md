# V29 validation record

- Node 22.16.0, local in-memory SQLite fixture.
- `npm test`: 96/96 PASS (includes existing V27/V28/V29 domain tests and new Markdown handoff tests).
- `node --check lib/api.mjs src/editorial.mjs lib/wechat-handoff.mjs`: PASS.
- TypeScript JSX syntax parse: `components/StudioApp.jsx`, `components/WeChatComposer.jsx`, `app/compose/page.jsx` all zero parse errors.
- `next build`: NOT RUN (dependencies not installed; npm registry unavailable in this environment).
- doocs/md remote/local Docker UI: NOT RUN (Docker/registry and browser cross-origin integration unverified here).
- GitHub repository: exists, admin/push permissions confirmed. HTTP git push from execution container unavailable due to external DNS. Github App connector can write README; full source push remains pending.

## Covered invariants
- Markdown text validation and serialization
- Channel layouts isolated from each other and original source paragraphs
- Immutable layout revision history and optimistic concurrency (409)
- Rejected stale original source revision
- Checklist invalidation and prevention of exporting stale HTML after doocs handoff
- Local-only endpoint origin protection inherited from the existing API dispatcher
