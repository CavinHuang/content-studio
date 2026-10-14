# Coding Agent brief — Content Studio

- Keep Next.js 16 App Router as the single primary web frontend. Do not create a second competing editor data model.
- Preserve V27 domain invariants: immutable revisions, `expectedRevision` conflict detection, independent master/wechat/zhihu, four per-channel manual checks, export != actual publish, and explicit sourcing of evidence.
- AI model output and community problem signals are hypotheses, not established facts. Protect private notes; no automatic publication.
- Never write real secrets, DB files, or user data to Git; honor .gitignore.
- `node:sqlite.backup` in V45 requires Node 22.16+ and a persistent single-process disk. Never deploy to Edge or a stateless serverless runtime.
- Default to localhost; require separate security work for authentication, authorization, CSRF, backups and multi-tenancy before production deployment.
- Every change: run `npm run check`, `npm test`, `npm run build` once dependencies are available; update QA reports honestly.
- User-facing interface: restrained off-white, forest green accent, five creator nav items, clear evidence/provenance, no noise.

- V49: operational `npm start` uses `scripts/runtime-guard.mjs` to deny unauthenticated remote access, public secret env names, demo seed and SQLite symlinks. Do not bypass this wrapper for production startup. After `npm run build`, execute `npm run test:production` for genuine process restart persistence.

- V50: Keep `/api/integrations/doocs/preflight` restricted to loopback root-only GET with no article data, redirect following or remote URL. It reports reachability, NOT real doocs/editor/publishing verification. All production builds MUST invoke `scripts/build-guard.mjs` to reject secret-like NEXT_PUBLIC configuration before bundling.

- V51: Real doocs/md compatibility smoke uses pinned Docker image `doocs/md:2.1.0`, two localhost services, and synthetic article fixture only. Never test against private user DB or automatically upload to cloud image beds. Keep actual platform/external export verification marked unverified.

- V52: when a channel image URL changes, preserve the former mapping in content_asset_mapping_history atomically; never automatically rewrite saved author-reviewed Markdown. Run npm run test:images:v52 and npm run test:doocs:real. Browser image URL fixture is intercepted, NOT a verified public CDN. Always distinguish source/editing success from real WeChat/Zhihu publication and access.

- V53: Public image observations are an explicit author opt-in only: saved current-mapping HTTPS URLs, max 3 per action, DNS all-address public validation, pinned HTTPS lookup, TLS cert verification, no redirects, short hard deadline and small byte budget. Do not let user request bodies specify fetch URLs or promote header observations into CDN, WeChat/Zhihu or publishing verification. Run npm run test:images:v53.

- V54: Consolidated integration must preserve exact V49-V53 head ancestry and exclude alternative V37 PR #8. Run npm run integration:preflight for premerge/postmerge history proof. It always leaves mergeAuthorized/deployAuthorized false; never infer external deployment approval or private-DB rehearsal from green CI. Merge only with independently confirmed hosting impact and operator approval, using a merge commit, not squash.

- V55: Operator release packet requires explicit private DB, WAL backup and a commit-bound, externally reviewed local manifest BEFORE running restored-copy checks. It prints a sanitized JSON report, never source paths/article content/secrets, and never auto-authorizes a merge. User-host check is not performed in CI; do not claim a real private database rehearsal has occurred. Use npm run test:release:v55 for synthetic negative cases.

- V56: release evidence freshness MUST compare schema, row-count SHA and type-aware every-row content SHA for source vs V45 verified backup, including PNG BLOBs. V56 tests use actual disposable SQLite files, never private production data. No automatic merge; keep candidate PR #26 Draft until real hosting deployment impact and operator private DB rehearsal are independently verified.

- V57: CI starts the real built Next.js production server on a V45 verified WAL backup restored to a DIFFERENT, disposable SQLite path, emulating an old pre-V52 missing table. Never launch production server on original source during smoke. Check preserved article/BLOBs, additive schema migration, restart, original per-row digest unchanged and tampered archive rejection; no platform publishing or merge approvals.
