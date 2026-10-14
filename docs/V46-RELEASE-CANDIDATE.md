# Content Studio V46 — Release Candidate Integration Gates

**State:** `feat/v46-integration-release-gates`, stacked Draft on V45 PR #17. This is a **tested integrated candidate branch**, not a `main` merge, deployed release, live-provider certification or platform publication.

## Why V46

V30–V45 were developed as a stacked series. V45 database recovery rehearsal used SQLite table row counts to decide whether existing records survived an upgrade. That assertion did not prove the actual *contents* were preserved: a migration could alter article text, evidence JSON, image BLOBs or mapped URLs while retaining the same number of rows. V46 closes that gap and adds an explicit release-admission report.

### A. Verify the full Git ancestry

```bash
npm run verify:stack
```

V46 walks the actual `git merge-base --is-ancestor` DAG for **main → V30 → V31 → ... → V45 → V46**. This is not based on PR titles or an inferred order. It fails if an expected remote branch is missing or a branch has diverged; it explicitly flags the alternate V37 PR #8 (`feat/v37-series-visual-library`) as *not canonical*. The canonical V37 is PR #9 (`feat/v37-visual-series-library`). The check also ensures the checked-out commit contains V46 and current fetched `main`.

GitHub Actions checks out full history (`fetch-depth: 0`) and executes this gate before dependency installation. It does not change remote branches, merge PRs or rewrite history.

This gate is specifically designed for **the V46 stacked candidate** while those refs exist. After successive merges/deletions, update its ref inventory before running it on main; a missing branch means the old lineage contract must be reviewed, not overridden with a misleading success.

### B. Stronger upgrade rehearsal: content, not only count

`npm run db:rehearse` still follows the V45 safe path: consistent SQLite online backup → sidecar SHA256 verification → restore to a throwaway database → initialize current services on the restored copy → integrity audit → delete all temporary files. It never writes to the source database.

In V46, before/after comparisons now fingerprint the **full value of every row** in each pre-existing SQLite business table, including UTF-8 text, JSON, nullable fields and raw image BLOBs. The encoding is type/length-aware. Tables are ordered by SQLite rowid (or composite primary key for WITHOUT ROWID tables) to make changes detectable. The only exception permits **new `source_state` entries** to be registered by bootstrap, while still comparing *all original entries byte-for-byte*. Existing non-source tables must have identical row count and digest.

Negative unit tests deliberately tamper with an article revision or image BLOB in a disposable copy *without changing row counts*. Both must fail. A mutation to an already-registered information source must also fail. These tests use artificial fixtures, not any private user data.

Caveat: this is a regression and pre-deployment rehearsal, not a reversible DDL migration engine, database encryption, distributed lock or zero-downtime upgrade.

### C. One-command read-only admission report

```sh
npm run release:admission -- --db=/absolute/path/content-studio.sqlite --backup=/secure/backup/last.sqlite --rehearse
```

No `--execute`, external billing or provider API calls are supported by this command. It uses read-only source checks, verifies the backup sidecar, and optionally rehearses on a disposable copy. The JSON contains only row/table counts, digests, schema status, configuration flags and the following explicit, unverified human handoffs:

- Real paid OpenAI/Nano Banana/Qwen smoke calls, entitlement and invoice checks (requires separate conscious authorization; V41 harness is one-call only)
- Real doocs/md external editor import/export and article preservation
- Real WeChat desktop paste, image CDN reachability, mobile preview
- Real Zhihu paste and mobile preview
- Off-device encrypted backup and operator recovery confirmation
- Explicit human release/merge/deploy authorization

`localGatesPassed=true` means **only local technical checks passed**. The report deliberately continues to return `productionReady=false`, `platformVerified=false`, `deployAuthorized=false` and `paidModelRequests=0`. It never prints API key material, raw article text, database rows or image bytes. If the DB/backup is missing, or the disposable upgrade fails, it exits nonzero and lists local blockers.

The operator must store any real evidence or invoices privately. Do **not** commit production database paths, screenshots, billing records, API keys, image binaries or backup manifests.

### D. CI and acceptance

```bash
npm run verify:stack
npm test
npm run test:recovery
npm run test:release
npm run check
npm run build
npm run test:e2e
```

CI uses synthetic SQLite articles, locally mocked image generation and the actual Next.js/Chromium interface; **no paid requests or external publishing websites** are invoked. It runs the release-chain check on fetched refs, regression tests that attack the SQL content invariants, and the V45 recovery rehearsal separately.

## Practical V46 integration/release runbook

1. Review canonical **PR #1 → #2 → #3 → #4 → #5 → #6 → #7 → #9 → #10 → #11 → #12 → #13 → #14 → #15 → #16 → #17 → #18** in order. PR #8 is an alternate V37 fork, not the parent of V38. This stage does not close or merge any PR.
2. Re-run GitHub CI against each integration step after its base changes. A green V46 branch test is **not** proof that current `main` contains V46.
3. Before any real user-data upgrade, identify the current Node version (22.16+), DB path, available space, running processes and previous app commit. Take an encrypted offline WAL-safe backup and keep its manifest.
4. Run `npm run release:admission -- --db=<REAL_SQLITE> --backup=<ACTUAL_BACKUP> --rehearse`. Investigate every local blocker. A successful report **does not replace manual QA**.
5. Perform a **separate** operator-reviewed test with actual model API entitlements/billing when explicitly approved. Then test doocs, WeChat and Zhihu *with real low-sensitivity drafts* and screenshots kept private.
6. Only after review/authorization, stop the old server, integrate and deploy, open at least one historical project/channel, check quality and QA history and image URL mappings. If necessary restore to a **new database path**, repoint `CONTENT_STUDIO_DB_PATH`, and restart; never overwrite an open database.

## Known limitations

- No access to a real user's production SQLite was available for this work; tests use synthetic persistent SQLite fixtures.
- No real external image provider calls, actual social-platform UI logins, uploads, publication or billing reconcilation have been executed in this CI.
- No automated main merge, production deployment, cloud-backup encryption, user authentication or multiuser isolation was performed.
- Fingerprint comparison identifies unexpected changes within the specific rehearsal window; it cannot guarantee all possible future migrations or runtime behaviors, and cannot replace verifying actual historical records.
