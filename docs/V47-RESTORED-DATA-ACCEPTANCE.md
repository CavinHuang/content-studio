# Content Studio V47 — Restored-database application acceptance

**Delivery:** a stacked Draft implementation atop V46 PR #18, not a main merge or production deployment.

V47 closes a V46 acceptance gap: **SQLite schema/data integrity being intact does not prove the current application can still open historical projects and complete new work on the recovered schema.** It now runs production domain services and HTTP request dispatch on a disposable restored copy, with no network model calls.

## How the rehearsal works

```bash
# Only use a local machine you trust; content may contain private drafts/images.
npm run release:rehearse -- --db=/absolute/path/private-content-studio.sqlite

# Full admission: independent supplied backup + upgrade check + application acceptance.
npm run release:admission -- \
  --db=/absolute/path/private-content-studio.sqlite \
  --backup=/secure/backups/previous.sqlite \
  --rehearse --integration
```

**Safety:** the required `--db` path is explicit. The CLI invokes the V45 SQLite WAL-safe backup API, verifies its manifest, restores into a new random owner-owned directory under the OS temporary directory, and initializes the V47 application **on that copy only**. It never opens the original with `createCore`, updates the original in place, posts anything externally, or replaces the configured database. It deletes temporary snapshots in `finally`, including on failure.

The temporary files contain the **full plaintext private SQLite content** while the rehearsal runs. Use it only on a trusted machine with secure/encrypted temporary storage and adequate disk space. Directory cleanup is **not** cryptographic secure erase. Real backups must remain encrypted and independently stored. It does not create a lasting report or export article bodies; stdout contains only counts and a SHA256 digest.

### Checks executed on the restored candidate

1. **Baseline:** capture type-aware digests of every pre-existing user/business SQLite table, including text, JSON, full binary image BLOBs, mappings, history and source state. Only SQLite's internal system tables are excluded.
2. **Initialize:** create V47 domain services on the restored copy and attempt to read up to 1,000 existing projects exhaustively. Check master and both channel documents, saved layout, illustration state and (where applicable) the delivery-readiness calculation. Exceeding the scan limit **fails closed** instead of pretending all records were inspected.
3. **Check historical contents unchanged** after domain initialization. An older SQLite schema may gain *new* tables/rows, but all original rows and original rowids must retain identical values. Missing or rewritten historical rows fail.
4. **Text-only smoke:** create one synthetic project, import Markdown into WeChat and Zhihu, record all four manual editorial checks in test data, explicitly waive illustrations for both channels, create two author-only readiness snapshots, then revise its master article. Assert both old approvals go stale, and no step claims true publication.
5. **Illustrated smoke:** create another synthetic project, plan three image slots, inject a **deterministic fake local generator** before any image requests, record mock approvals and file-compatible unique PNG bytes, map each asset to synthetic HTTPS URLs for both channels, record a synthetic author quality rubric, import Markdown through the existing revision-token API, check image link reconciliation, save simulated platform-QA attestations, and reach **local** readiness for both channels. Change only the WeChat image URL, assert its approval becomes stale while Zhihu remains current.
6. **Recheck all original rows**, SQLite `integrity_check`, and delete every temporary copy. The only new author audit records exist inside the disposable DB.

Note: The simulated image generator is deliberately injected into the restored copy and **never** calls OpenAI, Gemini/Nano Banana, Qwen or an external URL. Simulated manual attestations are exercise data, not actual human or platform validation.

## Report semantics

`release:rehearse` returns:

- `sourceUntouched=true`, `backupVerified=true`, `existingRowsUnchanged=true`
- `historicProjectsInspected`, `historicTablesProtected`, `historicRowsProtected`
- `synthetic.textOnly`: 2 channel imports/snapshots and 2 invalidation checks
- `synthetic.illustrated`: image slot count, 2 channels/snapshots, changed-URL invalidation and independent other-channel readiness
- `temporaryCopiesDeleted=true`, `paidModelRequests=0`, `platformVerified=false`, `actualPublishing=false`, `productionReady=false`

An exception makes the CLI exit nonzero and deletes its workdir. It does **not** conceal a problem by marking production ready.

The updated V47 `release:admission` additionally supports `--integration`. Without that explicit flag, its `integration.status` is `not_checked` and `candidateGatesPassed=false`; with the flag it invokes the actual rehearsal, reports a short non-sensitive summary, and still **always** returns `productionReady=false` / `deployAuthorized=false` / `platformVerified=false`.

This can establish **technical candidate checks**; it is not proof of a correct invoice, licensing, rights, external UI, account authorization or live publication.

## CI and reproducibility

```bash
npm run verify:stack
npm test
npm run test:recovery
npm run test:release
npm run test:integration
npm run check
npm run build
npm run test:e2e
```

Synthetic local CI includes a saved V29-style pre-V30 document schema, a full V46-style database with an existing image BLOB and channel mapping, a corrupted-row rejection test and a table-content tampering test. Additional release-admission tests confirm that no amount of local green status is translated into platform verification.

**Remaining acceptance required:** a trusted operator must run this against a real old database/backup locally, inspect representative historical drafts and media manually, perform explicitly authorized real provider smoke calls, paste into the real doocs/md/WeChat/Zhihu apps and confirm desktop/mobile rendering. No Draft PR has been merged to main by V47.

## Dependency sequence

The canonical active stacked path is PR #1→#2→#3→#4→#5→#6→#7→**#9**→#10→#11→#12→#13→#14→#15→#16→#17→#18→V47. PR #8 is an alternate V37 fork, **not** an ancestor of V38; do not merge it as a duplicate. `npm run verify:stack` validates main through V47 Git ancestry. A real merge requires an independent, explicit operator decision.
