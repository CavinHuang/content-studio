# V27 → V28 migration checklist

## Delivered
- New actual React/Next App Router shell with five creator nav items and three management routes.
- Integrated discover → evidence trail → Brief → SQLite project and editor (not an isolated mock).
- Unified editor for three versions, saved revisions and overwrite confirmation.
- Channel-specific checklist, local export, author-reported URL; no false publish claim.
- All existing domain `.mjs` modules and prior tests retained.
- Request object → domain API adapter tested without framework dependencies.
- Git history, CI workflow, gitignore, secure defaults and docs.

## Not yet verified or migrated
- `next build` / hydrated client browser E2E, blocked by dependency registry DNS in this execution environment.
- Full rich-text schema (images, code/table blocks, inline citations) for the Next editor.
- Native React UI for V26 precision correction, research evidence editing, feedback promotion (APIs and HTML fallback preserved).
- Exact cross-refresh behavior in a real Next dev server.
- Live API ingestion from outside; permissions and rate limits.
- Authentication/multi-user/authorization, public deployment and database backups.
- WeChat/Zhihu real editor paste behavior, posting and correction protocols.

## Suggested iteration after installing packages
1. Commit generated npm lockfile (`npm install` creates it) and change CI from `npm install` to `npm ci`.
2. Run `npm run build`, `npm test`, and Playwright against `http://127.0.0.1:4312`.
3. Implement block-based rich-text model and import of legacy articles with explicit diff/confirmation.
4. Implement identity & tenancy before allowing non-localhost deployments.


## V29 mature WeChat formatter decision
- Replace homegrown paragraph textarea as the primary composition experience with the doocs/md standalone editor handoff (`/compose`).
- No undocumented postMessage, URL injection, or cross-origin reading. Manual Markdown copy/import is explicit.
- Preserve SQLite revision history per WeChat/Zhihu channel; reject stale imports and block legacy HTML after layout handoff.
- React editor remains evidence, audit and corrections workspace at `/editor`; content shown there is read-only until a safe Markdown-to-claims mapping is implemented.
- Full rich document synchronization, media handling and exact WeChat/Zhihu paste behavior remain future verification tasks.
