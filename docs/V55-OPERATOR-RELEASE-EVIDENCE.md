# V55 — Local release-evidence collection, without automatic deployment authorization

**Purpose:** Close the gap between a green GitHub CI on synthetic content and a documented, operator-owned rehearsal on an actual Content Studio SQLite database. This is an *evidence collection workflow*, not a real production test performed by the coding agent, a merge permission, or a cloud deployment.

V55 updates the existing consolidated PR #26 directly; it does not add another stacked Draft PR.

## Existing CI evidence versus real operator evidence

Before V55, V54 checks real Git ancestors and file changes and the CI tests disposable databases, a Next.js production restart, pinned Docker doocs/md, image safety and browser rendering. These tests cannot know which local database an operator actually owns, whether a recent encrypted backup exists, or whether a main-branch push triggers an external hosting service.

V55 provides a local command which **requires actual operator-supplied paths**. It binds the resulting redacted report to the candidate Git commit, performs the existing read-only SQLite inspection, backup-manifest verification, source/backup schema, row-count and complete historical row-content fingerprints, V45 WAL-safe restored-copy upgrade, and V47 synthetic cross-channel integration rehearsal. It refuses to consider mismatched current-vs-backup database schemas successful. Missing stages are blockers. None of the operator's article text, stored image bytes, database paths or paid-model secrets are printed in its JSON report.

Run these operations **only on a trusted host** with a private encrypted working directory and temporary storage; the V47 rehearsal creates temporary plaintext copies and file deletion is not secure erase.

## 1. Prepare a real backup and verify your mainline checkout

Use an actual local clone at the exact consolidated PR commit (and a genuine private Content Studio database you control):

```bash
git fetch origin --prune
git checkout feat/v54-consolidated-integration-gate
git pull --ff-only
git rev-parse HEAD
npm install

# Read-only preflight checks on the database and current local startup
npm run integration:preflight
npm run runtime:preflight
npm run db:preflight -- --db=/private/host/content-studio.sqlite

# New snapshot path must not exist; the backup includes a manifest.
npm run db:backup -- --db=/private/host/content-studio.sqlite --out=/encrypted/releases/content-studio-pre-upgrade.sqlite
```

A new version of your candidate branch needs a new review that cites the new Git SHA. Do not commit or upload backups or a private report to GitHub.

## 2. Review deployment hooks on the actual hosting setup

An owner with access to the appropriate systems must review GitHub Settings → Webhooks, Environments and installed Apps, as well as the actual external hosting service and any repo polling or automatic deployment triggered by a push to main.

On an encrypted local path **outside the repository**, create `/encrypted/releases/v55.operator-review.json`. Example shape below. Replace the example SHA with the literal `git rev-parse HEAD` output, and use internal **reference identifiers**, not internal URLs, tokens, email addresses or people's names:

```json
{
  "schemaVersion": "content-studio-v55-manual-review",
  "candidateCommit": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "deploymentMode": "deployment-paused",
  "operatorRole": "release-operator",
  "hostingInventoryReference": "internal-host-review-2026-10",
  "rollbackReference": "documented-rollback-plan-2026-10",
  "backupLocationProtected": true,
  "rollbackInstructionsReviewed": true
}
```

Allowed deployment modes: `no-automatic-deployment`, `deployment-paused`, `controlled-manual-deploy`. These are **self-reported operator declarations**, not independent proof that the software has inspected a webhook or hosting provider. The tool validates manifest shape, commit binding and presence of a rollback reference, and **never** authorizes a merge.

## 3. Generate the redacted candidate evidence packet

```bash
npm run release:evidence:v55 -- \
  --db=/private/host/content-studio.sqlite \
  --backup=/encrypted/releases/content-studio-pre-upgrade.sqlite \
  --review=/encrypted/releases/v55.operator-review.json
```

The CLI prints a small redacted JSON object. You may redirect it to a protected `v55.release-evidence.json` **outside the repo**. The tool will return nonzero when a required local operation or manual declaration is missing. An incomplete but parseable report is printed with the specific blocker codes.

Expected categories:
- exact candidate SHA and main baseline SHA, canonical PR commit history;
- DB inspection status, WAL-consistent backup manifest and **matching source schema**;
- restored-copy upgrade status, immutable historic rows, original source untouched, temporary copies deleted;
- restored-copy synthetic integration, local manual deployment declaration;
- unambiguous `packetComplete`, `localEvidenceComplete`, and `blockers`.

Even if `packetComplete` is true, `hostingWebhookInventoryVerifiedByAutomation`, `finalHeadCIVerifiedExternally`, `mergeAuthorized`, `deployAuthorized`, `productionReady` and `realPublishingVerified` **remain false**. A green packet means the operator supplied structurally consistent local evidence, **not** that statements in an operator declaration have been independently checked.

## 4. Review and merge boundary

Only when an authorized operator has independently confirmed the deployment impact and rollback route, a protected backup, successful local rehearsal, and green **final-head** CI should the team consider merging PR #26. Continue to use a two-parent merge commit and inspect the resulting main-branch CI and host deployment logs.

V49–V53 PRs (#21–#25) should be closed as *superseded* only when their exact Git commits are reachable from the merged main. The alternative V37 PR #8 is unrelated and must not be included.

This stage does **not** perform an actual publication to WeChat/Zhihu, a billed image model call, a private database upgrade on a user machine, or any deployment.

## Regression safety

```bash
npm run test:release:v55
npm run test:integration:v54
npm run build
npm run test:production
npm run test:e2e
npm run test:doocs:real
```

V55's regression suite uses **synthetic reports and temporary manifest files only**, never a real user database. Tests enforce Git SHA binding, missing-manifest failure, source-vs-backup schema mismatches, no silent approval on failures, rejecting unsafe free-text, keeping private data out of the report, and prohibiting any DB access when the candidate history is already invalid.

**Do not paste raw operator-review files, actual private paths, host URLs, secrets or database backups into a GitHub issue or PR discussion.**


## V56 additional safety

An intact backup manifest is insufficient if the source has changed since the snapshot was taken. V56 adds read-only per-table/per-row content fingerprints (including BLOBs), as well as row-count digests, to the same candidate evidence command. Recreate a WAL-safe backup if any old-snapshot mismatch is reported; never override it. The real-file-backed **synthetic** regression tests are described in [V56](V56-REAL-FILE-RELEASE-ACCEPTANCE.md). Genuine operator content and external hosting triggers remain uninspected until run by the authorized owner.
