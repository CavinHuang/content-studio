# Content Studio V49 — Production-process acceptance & local startup hardening

**Implementation branch:** `feat/v49-production-runtime-acceptance`, based on integrated V48 `main`. This is a release-candidate validation stage, NOT a public production deployment or live external-platform certification.

## Why V49

V30–V48 are now integrated to main and have passed synthetic domain/API and Chromium tests. One gap remained: the real `next start` process was not independently stopped and restarted mid-workflow to verify actual on-disk SQLite continuity. Another risk: the app has **no user login**. Accidentally enabling remote access, exposing secrets through `NEXT_PUBLIC_*` or allowing demo-fixture seeding on an operational server could disclose or mutate personal drafts.

V49 closes both gaps without sending private article content to any third-party system.

## Startup contract

```bash
npm install
npm run runtime:preflight  # reads the same local environment-file hierarchy as Next
npm run build
npm start                  # always bound to 127.0.0.1:4312 by default
```

The `start` command now goes through `scripts/runtime-guard.mjs`. It loads Next's .env hierarchy *before* assessing settings and refuses startup for:

- Node below 22.16, unsupported legacy 21.x, invalid TCP port or `HOST` set outside loopback;
- `CONTENT_STUDIO_ALLOW_REMOTE=1` (unauthenticated remote API) or `ENABLE_SCENARIO=1` (writes example data);
- `CONTENT_STUDIO_DB_PATH=:memory:` (no durable storage);
- SQLite path that is a symlink (including **dangling symlinks**) or non-file;
- populated `NEXT_PUBLIC_*` variables with names indicating an API key, token, password or secret (these can be bundled into browser JS).

Default path is `./data/content-studio.sqlite`, and an absent DB gets a warning (first start is permitted to create it). Other, non-sensitive optional provider variables can remain unset. The command records problem **codes only**; it does not echo secret values, original article content or image bytes. As an extra safeguard, the launched Next process receives `CONTENT_STUDIO_ALLOW_REMOTE=0` and `ENABLE_SCENARIO=0`.

**Important caveats:** this guard runs with Node `next start`, not `next dev` or a custom process manager invoking `next` directly. Use **only** the guarded startup command operationally. It is not a replacement for authentication, host firewall rules, OS file permissions, TLS termination or CSRF threat modeling. NEXT_PUBLIC build-time values can be inlined in JS **before** startup; inspect the build configuration and do not build with secrets in NEXT_PUBLIC even when runtime reports safe.

## Actual post-build restart smoke

```bash
npm run build
npm run test:production
```

After the real Next.js 16 production build, the test:

1. Allocates a random loopback port and private disposable directory under OS temp.
2. Starts a real production `next start` process via the guarded launcher, with no provider keys and no fixture seeding.
3. Reads real health API, creates a synthetic editorial article over HTTP, imports WeChat Markdown with review-token semantics, records four manual checks, explicitly declares a text-only article, and stores a synthetic author-only delivery snapshot.
4. Verifies cross-origin mutation and fixture-seeding attempts fail with **403**.
5. Terminates the Next server process, launches a brand-new process against the **same isolated SQLite file**, then verifies article body, channel revisions, saved layout, consent/decision and immutable snapshot persisted. A stale revision update still returns **409**.
6. Terminates the second server and cleans the temporary database. No external network, paid generation or actual platform publication occurs.

This differs from `createCore(':memory:')` tests and browser tests that start/stop a server **only once**: the production process itself must survive a real restart without losing state.

The CI workflow runs `npm run test:production` after Next build and before Playwright E2E. The smoke runs against `127.0.0.1` only; all author facts and QA confirmations are explicitly **synthetic fixtures**, not live author verification.

## Optional real-world acceptance — separate human gates

The V49 CI **does not** test actual OpenAI/Nano Banana/Qwen model access, billing, licenses, doocs, or publishing-platform UI. After explicitly choosing to incur a bounded request, the existing V41 harness can exercise exactly one paid image provider call:

```bash
# Zero-cost local contract discovery first
npm run smoke:image -- --provider=openai

# OPTIONAL ONLY with explicit informed approval + a real provider key:
# Set CONTENT_STUDIO_PAID_SMOKE_CONSENT=I_ACCEPT_ONE_BILLABLE_IMAGE_REQUEST
# npm run smoke:image -- --provider=openai --max-requests=1 --execute
```

Do not run a real paid smoke without conscious consent. The harness uses a synthetic prompt, an in-memory DB and no fallback, publishing or optional evaluator. Environment configuration alone is not proof that any model exists or accepts a request. Keep billing/invoice data private.

For doocs/md and destination channels:
- Launch the standalone doocs/md locally (if installed); manually copy a **non-sensitive sample** into it, export Markdown, import through Content Studio, and review V30/V31 differences.
- On **actual** WeChat and Zhihu test platforms, manually paste an authorized sample with user-owned imagery; verify image loading, desktop/mobile appearance and any external image relinking or rights constraints.
- Record the **author-reported** platform QA in the app. There is no remote verification, auto-login or auto-publication, and no green GitHub CI is evidence that a platform accepted the content.

## Operational data protection and rollback

For any *real user's* SQLite, start with V45's WAL-safe backup (`npm run db:backup`) and encrypted/offsite storage. Rehearse with `npm run release:admission -- --db=<private-db> --backup=<checked-backup> --rehearse --integration` on a **trusted encrypted disk**: temporary recovered copies contain private plaintext until deleted. Do not publish or commit SQLite backups, screenshots, personal articles, credentials or manifests. Restart by fully stopping the process, then `npm start`. On a failed migration, stop it and restore only to a **new** DB path; never overwrite a live SQLite file.

The final acceptance report should distinguish:

| Check | CI can prove | Requires human / live system |
| --- | --- | --- |
| Node, guarded loopback binding, rejects dangerous local flags | Yes | Review host ACL/firewall and actual operator deployment |
| Real Next build/restart, SQLite article and draft persistence | Yes (synthetic) | Real private DB recovery on operator's own trusted host |
| Source-backed authoring, Markdown diff, image quality and snapshot rules | Synthetic end-to-end | Editorial facts, image copyright, actual approved assets |
| Image provider contract | Offline config only | Explicit paid call, capability and billing validation |
| doocs/WeChat/Zhihu | No network platform test | Real import/paste/mobile UX and optional manual publication |
| Secure public/multi-user hosting | No — unsupported | Separate identity, authorization, CSRF, TLS and tenancy design |

**Release boundary:** V49 makes the **local application startup and on-disk recovery workflow more credible**. It does not certify a public SaaS, a third-party integration or a production deployment.
