# V48 — Canonical stacked-feature integration to main

**Snapshot (2026-10-14, Singapore)**

- Previous `main`: `071db4295302a10e5214a0a0835c05d13b3e7c39` (V29).
- V47 canonical tip: `4ad7ff2eac7b9896f55f8378671e3f44525ac4a8`.
- GitHub commit comparison of main → V47 was **ahead by 152 commits, behind by 0, 93 changed files**. There were no divergent commits to reconcile before V48.
- The canonical linear chain is **main → PR #1 (V30) → #2 → #3 → #4 → #5 → #6 → #7 → #9 (V37) → #10 → #11 → #12 → #13 → #14 → #15 → #16 → #17 → #18 → #19 (V47) → V48**.
- **PR #8** (`feat/v37-series-visual-library`) is an **alternative V37 fork** and must not be integrated. PR #9 (`feat/v37-visual-series-library`) is the canonical ancestor of all later versions.

## Integration decision and Git safety

Rather than asking GitHub to independently rebase/merge 18 nested Draft PRs and risk changing commit ancestry or creating repeated content, V48 prepares one **consolidated integration PR targeting `main`** with `feat/v48-mainline-integration` as head. The branch is a direct descendant of all canonical PR heads; no feature changes from those PRs are omitted.

**Merge method must be `merge` (two-parent merge commit), not `squash` or `rebase`.** This preserves all prior commits for history and recovery, and makes GitHub's integrated-mainline CI able to find immutable commit anchors. All pre-merge checks must pass on both the feature push and the actual PR merge ref before merging. Inspect branch permissions and Actions workflows. Neither this document nor a green CI authorizes external deployments, real publishing or paid model traffic.

Only `.github/workflows/ci.yml` exists in the repository at the time of review; it runs test/build and does **not** contain a production deploy job. If hosting is connected outside repository Actions, treat merge as a potential production action until separately assessed.

### Integration-proof modes

The old V46/V47 `verify:stack` assumed `origin/main` was a *parent* of every historical feature branch. After merge, that is no longer true: main now contains the features. Without a fix, every next `main` CI would fail even though integration was correct.

V48 supplies:

- `npm run verify:stack` — strict **pre-merge** check of main→V30→…→V48 (20 remote refs); useful for auditing the unmerged stack.
- `npm run verify:main` — strict **post-merge** check of integrated main history by immutable anchor SHAs (original main, V30 head, canonical V37 head, V47 head), exclusion of the alternate V37 head and minimum package version. It also checks the invocation is on current main.
- `npm run verify:integration` — **adaptive CI gate**. When origin/main does not contain V47, validates the strict stacked chain. Once it contains V47, validates the integrated mainline anchor set and requires the current checkout (including future PRs) to descend from current origin/main. This avoids breaking all later PRs with a one-time stack verifier.

The integrated-mode checker does **not** require previous Draft branch refs to stay alive, so the historical commits remain verifiable if retired branches are removed later. Regression tests simulate the alternate fork being accidentally merged, a missing V47 ancestor, an old version, an unrelated PR checkout, or a missing V48 branch.

## Release checks and evidence

```bash
# Before merge, on V48 feature branch:
npm run verify:integration
npm test
npm run test:recovery
npm run test:release
npm run test:integration
npm run test:mainline
npm run check
npm run build
npm run test:e2e

# After merge, on fresh main checkout with full Git history:
npm run verify:integration
npm run verify:main
npm test
npm run test:recovery
npm run test:release
npm run test:integration
npm run test:mainline
npm run check
npm run build
npm run test:e2e
```

The CI program uses synthetic SQLite and fake loopback image providers; its runs do **not** upload any genuine article, image, secret, invoice or publishing URL. It does not call a paid image model, use actual doocs/md, or check the real WeChat/Zhihu UI. The repository remains a **single-user, localhost-only** Next.js and SQLite application; it is not an authenticated, multi-tenant public service.

## After merge, verify operational status

1. Confirm the consolidated PR merge SHA is reachable from GitHub `main`. The feature head and canonical V47 SHA must be ancestors; alternate V37 head must not.
2. Verify the **main push** GitHub Actions job with the new integrated-mode lineage checker and full Next.js build/Chromium E2E. A green PR check alone is not sufficient.
3. Inspect the prior Draft PRs. If GitHub does not auto-close them, close only those whose *exact head SHA* is provably reachable from main and link to the consolidated integration PR; never close the alternate PR #8 as if its changes were integrated.
4. Follow the V45–V47 runbooks to backup and rehearse a **real database on the operator's own trusted machine**. No real user DB was available to the coding agent.
5. Keep the actual provider billing smoke (explicit approval), doocs/md roundtrip and target-channel desktop/mobile appearance as separate manual gates. Neither `productionReady` nor `platformVerified` becomes true from CI.

A restored SQLite test proves a *synthetic* application smoke; it cannot prove real user accounts, a real provider bill, or a target platform accepted the content.

## Rollback / failure response

If main CI fails or the merged feature has a critical issue, stop any running application **before** manually repointing databases. Prefer an explicit reverting PR of the integration merge (inspect its parent and dependency tree carefully); do not force-push main. Preserve WAL-safe pre-upgrade backups and their manifests. Never restore directly over a live SQLite path. An operator must verify actual file paths, deployment triggers and rollback plans separately.
