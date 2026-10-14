# V45 — Stacked Draft PR Integration Plan (review snapshot)

**Repository:** `CavinHuang/content-studio`. **Source:** GitHub PR list inspected 2026-10-14. This is a *manual integration plan*, not evidence that the branches were merged, tested against real user content or deployed. The app is still local-only.

## Canonical dependency path

The current main branch precedes V30. Merge **from the bottom of the stack upward**, after reviewing each PR and running its own checks. Do not merge V45 directly into main.

| Order | PR | Topic | Expected base |
| --- | --- | --- | --- |
| 1 | #1 — V30 | doocs Markdown evidence review | `main` |
| 2 | #2 — V31 | paste compatibility QA | `feat/v30-markdown-evidence-review` |
| 3 | #3 — V32 | automatic image illustration | `feat/v31-channel-paste-compat` |
| 4 | #4 — V33 | multi-provider generation | `feat/v32-agent-auto-illustrations` |
| 5 | #5 — V34 | bounded retry and visual identity | `feat/v33-multi-model-illustration-agent` |
| 6 | #6 — V35 | reference image editing | `feat/v34-visual-review-retry` |
| 7 | #7 — V36 | image candidate feedback memory | `feat/v35-reference-image-editing` |
| 8 | **#9 — V37** | opt-in visual-series reference library | `feat/v36-image-feedback-memory` |
| 9 | #10 — V38 | request budgets | `feat/v37-visual-series-library` |
| 10 | #11 — V39 | durable illustration queue | `feat/v38-image-request-budgets` |
| 11 | #12 — V40 | provider contract and manual platform QA | `feat/v39-durable-illustration-queue` |
| 12 | #13 — V41 | Chromium E2E and paid smoke guard | `feat/v40-provider-contract-preflight` |
| 13 | #14 — V42 | image audit and visual regression | `feat/v41-browser-live-smoke-gates` |
| 14 | #15 — V43 | author quality and Markdown image roundtrip | `feat/v42-visual-audit-handoff-regression` |
| 15 | #16 — V44 | consolidated delivery readiness | `feat/v43-image-quality-roundtrip` |
| 16 | V45 (this branch) | WAL-safe database recovery & upgrade rehearsal | `feat/v44-unified-delivery-readiness` |

**Important competing alternative:** Draft **PR #8** (`feat/v37-series-visual-library`) also branches from V36, but **PR #9** is the V37 implementation used by V38 and all subsequent work. PR #8 is **not** part of the active dependency path. Keep it separate; **do not merge both** as if #8 were an ancestor of #9. After human review, choose whether to close PR #8 or archive it. This stage does *not* close the alternative or merge anything without authorization.

## Release gate for each merge

1. Check that the PR's base and head still match the intended chain; verify the target branch does not already contain equivalent changes and make a focused comparison before merging.
2. Prefer integrating one dependency at a time (V30 → V31 → …). Rebase/update the subsequent PR only as appropriate to keep history understandable. Re-run GitHub Actions after any base/head update.
3. Before the **first real database open with new code**, take an operational `db:backup` and run `db:rehearse` on the current database using Node 22.16+. Never copy only the live WAL file.
4. Verify synthetic `npm test`, `npm run test:recovery`, `npm run check`, `npm run build`, `npm run test:e2e` against the assembled revision.
5. Compare a real article's evidence claims, channel document revisions, persisted image bytes and mappings, V40 author QA history, V43 quality ratings and V44 delivery snapshots **manually**, preferably using a restored copy.
6. Authorize and budget one controlled image-provider smoke request **separately** if desired. Do not infer that provider model entitlement, billing or doocs/WeChat/Zhihu copy/paste has passed from mock CI.
7. Never expose the Node app on a public interface until authentication, CSRF, ACL and deployment/runtime requirements are separately implemented.

### Known gaps after V45

- **No real account, paid-model, doocs/md, WeChat or Zhihu acceptance** has been executed by these GitHub CI runs.
- **No actual personal production database upgrade** has been executed: the migration rehearsal uses a synthetic historical schema fixture and can be invoked locally against a user's database.
- Current database initialization is table-create driven, not a full versioned migration framework with reversible forward/backward DDL. V45 adds a safety and restore gate, **not** a transactional schema migration engine or an automatic rollback.
- Sequential Draft PRs remain unmerged; a passing feature-branch CI must not be mistaken for the integrated main branch being ready.
