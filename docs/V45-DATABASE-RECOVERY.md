# Content Studio V45 — SQLite recovery, upgrade rehearsal and release boundary

**Stage:** stacked Draft PR based on V44, not merged to `main`. No live user database, paid provider account, doocs/md editor, WeChat or Zhihu was accessed while implementing or running CI.

## 1. Why this needs a separate stage

Content Studio is a **single-process, stateful Node.js 22 / SQLite application**. The accumulated V27–V44 feature branches register tables on startup (with `CREATE TABLE IF NOT EXISTS`), including immutable editorial document history, image assets, quality rubrics, queues, publication reports and author evidence. A production rollback cannot be treated as a revert of JavaScript alone: older code may not understand data or tables created by a newer version.

**A live WAL-mode SQLite file cannot be safely backed up by blindly copying only `content-studio.sqlite`.** Committed transactions may still live in the `-wal` file. V45 uses Node's `node:sqlite.backup()` API (Node **22.16+**) and validates a standalone SQLite snapshot. No remote database, background daemon, automatic destructive migration or external model call is introduced.

## 2. Commands (local terminal only)

```sh
# No write to an existing database. Validates SQLite integrity and FK metadata.
npm run db:preflight
# For nondefault SQLite path:
npm run db:preflight -- --db=/absolute/path/private-studio.sqlite

# WAL-safe backup to data/backups/ with a separate .manifest.json.
npm run db:backup
# Or explicitly choose an unused destination on a separate mounted disk:
npm run db:backup -- --db=/absolute/source.sqlite --out=/secure/backup/studio-2026-10-14.sqlite

# Restores only to a NEW file; there is no 'force' or 'overwrite' switch.
npm run db:restore -- --from=/secure/backup/studio-2026-10-14.sqlite --to=/secure/restore/studio-recovered.sqlite

# Temporary backup -> manifest check -> restore -> register latest app tables,
# compare existing business row counts, then delete disposable copies.
npm run db:rehearse
npm run db:rehearse -- --db=/absolute/source.sqlite
```

Default DB comes from `CONTENT_STUDIO_DB_PATH` or `./data/content-studio.sqlite`. `DB_PATH` is only the deprecated legacy server setting and is not used by this CLI. Never run `npm run legacy:dev` concurrently with the main server on the same production database.

### PowerShell (Windows)

```powershell
$env:CONTENT_STUDIO_DB_PATH = 'D:\\ContentStudio\\data\\content-studio.sqlite'
npm run db:preflight
npm run db:backup
npm run db:rehearse
npm run db:restore -- --from="D:\\ContentStudio\\data\\backups\\some-existing-file.sqlite" --to="D:\\ContentStudio\\data\\recovery\\restored.sqlite"
```

**Protect the result:** the SQLite backup contains **private articles, unpublished ideas, possible evidence and image bytes**. Its SHA256 sidecar is for accidental corruption detection, **not encryption or authentication**. Store backups on an encrypted, access-controlled disk, preferably also offline. POSIX files use restrictive `0600` permissions; on Windows rely on NTFS ACL/BitLocker since chmod does not replace ACLs. `data/backups/`, `*.sqlite` and associated manifest filenames are excluded from Git.

## 3. Guarantees and deliberately missing features

The V45 CLI:
- Creates a unique temporary snapshot through SQLite's backup API, then atomically exposes a new final file. Destination collision is an error; an existing backup is never overwritten.
- Writes a `*.manifest.json` with format/version, filename, byte count, SHA256, schema digest and per-table row-count digest. No article text or images are copied into the manifest.
- Checks SQLite **integrity**, foreign-key consistency and the manifest checksum before accepting a restore. A corrupt or missing manifest is refused.
- Restores to a **brand-new path only**. It neither switches the running application over to the recovered DB nor deletes/overwrites the original DB. This avoids corrupting a live SQLite/WAL session.
- Uses a throwaway temporary folder for upgrade rehearsal and deletes it even on failure. Source is only opened read-only; the current `createCore()` initialization runs **only on the restored copy**.
- Fails rehearsal if any preexisting business-table row count changes unexpectedly. The sole permitted additive count is `source_state`, because bootstrapping new default connectors may legitimately register new provider IDs. The V45 regression test independently checks that an old editorial document and version remain readable.

The implementation does **not**:
- Encrypt backup content, ship backups off-site, schedule automatic snapshots, handle rotating retention, or verify full multi-device disaster recovery.
- Prove semantic equivalence for **every** existing database table on arbitrary real production data: the test fixture covers a legacy project, while the rehearsal enforces old row-count preservation. Actual operational upgrade still requires reviewing real application records.
- Reliably provide concurrent multi-process SQLite migration locks, zero-downtime restore or a cross-version down migration. Run the app as a single process on persistent storage.
- Validate live image-provider billing/entitlements or target platform paste/rendering; these remain separate manual acceptance gates.

## 4. Recommended update and rollback runbook

1. **Inventory versions and processes.** Record the currently deployed Git commit and Node version; ensure Node is at least 22.16. Check `CONTENT_STUDIO_DB_PATH` and available disk capacity.
2. **Create an actual WAL-safe backup** with `npm run db:backup`, keep the `.manifest.json` next to it. Verify the JSON reports `verified:true` and independently copy both files to encrypted offline storage.
3. **Rehearse upgrade** using `npm run db:rehearse` before deploying new code. If any step fails, **do not start the new version against the current production SQLite**.
4. **Stop the Content Studio Node process** during actual application release. Keep the old version/backup; deploy the new code and run `npm run db:preflight`. Open the app and manually verify at least one historic article, its image mappings, import revisions, V40 QA and V44 delivery snapshots.
5. **Rollback:** stop the app, run `npm run db:restore -- --from=<backup> --to=<NEW_DESTINATION>`. Verify the recovered DB with `npm run db:preflight -- --db=<NEW_DESTINATION>`. Point `CONTENT_STUDIO_DB_PATH` at the verified new file and restart the older compatible app version. **Never replace the original while it is open.** Changes made after the backup will not exist in the recovered copy.
6. **Real deployment signoff** still needs provider-specific, paid-call authorizations and independent doocs/WeChat/Zhihu reviews. A successful schema rehearsal is not a publication or compliance audit.

## 5. CI evidence and stacked PR integration

The `npm test` suite now includes synthetic persistent SQLite regression cases: open WAL with writes not yet checkpointed, backup metadata, no-overwrite restore, missing/tampered manifest, legacy editor-table schema upgrade, source immutability and CLI misuse. An independent `npm run test:recovery` job in `.github/workflows/ci.yml` intentionally reruns the recovery cases as a release gate. No production DB is copied into public CI.

Before merging the long V30→V45 stack:
1. Confirm the dependent PR chain and sequential base/head references; **do not squash a downstream branch directly into an older base** without reconciliation.
2. Merge from oldest dependency to newest, rerun CI on each newly updated base and check resulting migration/rehearsal behavior.
3. Back up any real private database **outside CI** before running a new version. Do not commit credentials, snapshots or production content into the repository.
4. Check `npm run check`, `npm test`, `npm run test:recovery`, `npm run build`, `npm run test:e2e` on the final integration branch, then complete manual browser/provider/publishing acceptance.

### Manual acceptance checklist

- [ ] Actual user's old article, channel revisions and cited research history reopen.
- [ ] Previously approved image files and channel URL mappings still load.
- [ ] Existing V43 quality reviews and V44 readiness history remain immutable.
- [ ] No paid calls made by startup or upgrade.
- [ ] User-generated Markdown survives backup/recovery byte for byte.
- [ ] WeChat/Zhihu copy/paste and mobile previews checked separately.
- [ ] Recovery tested on a separately restored file with the running server stopped before switchover.

**Evidence boundary:** the automated checks can validate the synthetic local workflow, file checksum, SQLite integrity and stable legacy table row counts. They cannot verify a specific real user's backups or external service state until an operator runs these commands against that environment.
