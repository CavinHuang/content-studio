# Content Studio V57 — Verified restore-to-production staging acceptance

V57 extends V56's real SQLite WAL backup and restored-copy acceptance with **a real Next.js production process that boots and restarts using a restored legacy database**. It is merged into the existing consolidated Draft PR #26, not a new stacked PR.

## What the actual automated test does

After `npm run build`, `npm run test:staging:v57` performs an isolated end-to-end test:

1. Create a real on-disk SQLite source holding a synthetic historical project, versioned article paragraphs, PNG BLOB, manual channel image URL and a synthetic private sentinel. Delete the V52 `content_asset_mapping_history` table to emulate a database saved before that additive schema was introduced.
2. Record read-only source schema, row-count and **full historical row-content hashes**; use the V45 WAL-safe backup API to create a separate archive with a manifest. Verify that manifest and restore the snapshot to a **different nonexistent path**.
3. Start the **actual built Next.js production server** through `scripts/runtime-guard.mjs start`, bound to a randomly selected `127.0.0.1` port with `CONTENT_STUDIO_DB_PATH` pointing **only at the restored copy**. All test provider keys are blank, scenario seeding and remote access disabled.
4. Exercise real HTTP APIs: project and revisions survive, article body is unchanged, local image preview matches the original PNG bytes, channel mapping is unchanged, and the delivery state remains explicitly `platformVerified:false` and `published:false`. Fixture seeding stays forbidden.
5. Change an image URL in the **restored copy only**, exercising the latest additive V52 schema migration in a real production process; stop the server, restart it on that same restored database and verify the new image mapping history persists while historic documents and BLOBs remain intact.
6. Read the **original source database again**, checking full schema, row counts and every-row content hashes against the original before starting the production process, and confirm the original URL and article are untouched. The verified archive also remains intact.
7. As a negative case, tamper with the manifest checksum; the restore must fail **before** creating any target database or starting a production server.

This is a genuine database filesystem and server-process integration test, not mocked SQLite or a simulated HTTP listener.

## Commands

```bash
npm install
npm run build
npm run test:staging:v57
npm run test:release:real-files:v56
npm run integration:preflight
```

CI runs V57 immediately after the Next.js production build and V49 production restart, before Chromium and real doocs/md Docker tests. This test does not need Docker.

## Important limitations

- Only **synthetic test records** are used in CI; there is no proof an actual user's private database or hosting config has passed.
- The test starts the restored database in a localhost staging process and ensures the historical source stays untouched. It does **not** invoke a production or hosting provider.
- It covers a representative pre-V52 missing table, not every historical production schema in existence.
- A test archive and restored database temporarily contain synthetic plaintext content and are cleaned up afterward; these tests are not a substitute for encrypted backups or secure erase guarantees.
- Real operator approval of externally configured auto-deploy hooks is still outstanding. This test does not authorize a merge, deploy, paid model call, CDN upload or WeChat/Zhihu publication.

## Required actions to move beyond CI

1. Inspect GitHub webhooks, installed integrations and the actual hosting platform for `main` auto-deploy behavior. Explicitly document pause and rollback controls.
2. On the authorized **trusted** machine, create a fresh WAL-safe backup of the real original SQLite; use `npm run release:evidence:v55` with an operator review manifest pinned to the **current final PR commit**. Avoid exposing private paths, article data or secrets in PRs.
3. Validate target-system resource limits and recovery/rollback. Only after independent approval and final-head green CI consider merging consolidated PR #26 by a two-parent merge commit.

**Neither `main` nor real hosting is changed in V57.**
