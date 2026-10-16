# V54 — Consolidated integration of V49–V54

Status: **premerge technical review; not authorized for deployment or publication**. Reviewed 2026-10-14.

## Verified repository state

- Last integrated main commit: 9c6dfaa03dacb1689d1e9c256e707ab7ac094ece (V48).
- Reviewed V53 head: 2fd2496a2a7d514ea6af16fb6e95d545242580b9, ahead 74 commits, behind 0 relative to main before V54.
- Canonical sequence: PR #21 V49 → #22 V50 → #23 V51 → #24 V52 → #25 V53 → consolidated V54.
- PR #8, the alternate V37 design, is **not** part of this branch and must remain separate.
- The only visible GitHub Actions workflow is ci.yml; it tests and builds but has no explicit deployment step.
- The GitHub connector does NOT provide access to Webhooks or Deployments endpoints. External main-push auto-deploy is therefore **UNKNOWN**, not absent.
- Main was not protected during review. Do not use passing CI as authority to merge.

## What is now automated

Use a full-history checkout with current origin tracking refs:

    npm run verify:integration
    npm run integration:preflight
    npm run test:integration:v54

The new preflight does not contact remote servers or read private SQLite. It checks:
1. Original main SHA remains the reviewed baseline before integration.
2. V49–V53 feature heads equal **specific reviewed commit SHAs**, not merely branch names.
3. Every canonical stage is a Git ancestor of the next and of the proposed current checkout.
4. PR #8 is not an ancestor, package version is 0.54 or later, and current checkout descends from main.
5. Changed paths that affect deployment, build, local startup or database persistence are listed for review.

Once main actually includes V53, the checker switches to immutable Git anchors and does not require deleted historic Draft branch refs. The result explicitly keeps mergeAuthorized=false, deployAuthorized=false, externalDeploymentHooks=unverified, productionReady=false. These values are **not** auto-promoted by a green technical check.

## Operator approval required BEFORE merging the consolidated PR

A trusted repo and hosting administrator must manually inspect:

1. GitHub Settings → Webhooks and the subscribed push events (do not expose signing secrets).
2. GitHub Settings → Environments, installed GitHub Apps and organization-level integrations.
3. Hosting dashboards and any polling/auto-deploy triggers outside GitHub: Coolify, Vercel, Netlify, Render, Railway, custom CI, Docker hosts, etc. GitHub Webhooks alone are not a complete deployment inventory.
4. The effects of main branch updates, whether a deployment can be paused, and a tested rollback process.
5. Real runtime configuration of the single-user local-only app (V49), build-time public environment variables (V50), pinned doocs image (V51), and the additive SQLite image mapping history schema (V52).
6. Current data backups, encryption, storage permissions and sufficient space on the actual host.

If any of these are unknown, do NOT merge. User acceptance of ongoing development is not a substitute for an external deployment-impact review.

## Real host recovery rehearsal (operator only)

On a trusted machine, without committing private data or secrets:

    npm install
    npm run runtime:preflight
    npm run build:preflight
    npm run db:preflight -- --db=/actual/path/content-studio.sqlite
    npm run db:backup -- --db=/actual/path/content-studio.sqlite --out=/encrypted/backup/snapshot.sqlite
    npm run release:admission -- --db=/actual/path/content-studio.sqlite --backup=/encrypted/backup/snapshot.sqlite --rehearse --integration
    npm run build
    npm run test:production

The V45 backup uses WAL-consistent SQLite snapshotting and a sidecar manifest. V47's rehearsal creates temporary plaintext copies of the private database; only use it on trusted, encrypted temporary storage. Clean-up is NOT equivalent to guaranteed secure erase. Never restore over a database held open by a running server.

Note that CI's restart test uses disposable synthetic data. The commands above have **not** been executed on anyone's actual private database.

## Release sequence

1. Review the **single consolidated V54 Draft PR targeting main**. Confirm exact head SHA, mergeability and a green PR CI on that SHA, including all original recovery, production restart, Chromium and real doocs Docker tests.
2. Complete the external deployment-impact checklist and independent encrypted backup rehearsal.
3. Only then, with explicit deployment/operator approval, use a **two-parent merge commit**. Do not squash/rebase the nested Draft PRs separately.
4. Inspect the **actual main push CI** after merging; the integrated mainline ancestry check must pass. If anything fails, stop further production rollouts.
5. Close superseded PRs #21–#25 only AFTER proving each specific head commit is an ancestor of main; annotate each with the consolidated PR link. Leave unrelated alternative PR #8 alone.
6. Perform separate explicit real-world acceptance for paid image providers, actual authorized CDN images, and WeChat/Zhihu desktop/mobile UI and account publishing. A header-only HTTPS image response cannot certify any of these.

## Failure and rollback

Do not force-push main or replace a live SQLite file. Stop the application before touching a failed migration. Preserve snapshot and manifest, restore to a NEW path, and have an authorized operator review a Git revert of the merge (code rollback alone is not a database rollback).

**V54 completes integration tooling and evidence; it does not certify production release readiness.**
