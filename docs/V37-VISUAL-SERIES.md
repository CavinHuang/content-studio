# V37 · Visual Series Library / 系列视觉记忆

Status: local-only implementation; stacked Draft PR #8 on V36 PR #7. Do not merge straight into main. Real external provider editing, WeChat, Zhihu and production authorization remain unverified.

## Why

V36 remembered explicitly opted-in feedback only within one article. Authors writing a series need a stable visual identity and reusable reference images without silently exposing private notes/images from unrelated projects.

## Flow

1. In `/illustrations`, create a series using the current article's visual profile, or choose an existing one. Creating a series does **not** add a project automatically.
2. **Explicitly join** an article. Each article belongs to at most one series. Other article feedback and documents are never copied.
3. Edit the series identity (name, palette, mood, prohibited elements). Every update requires `expectedRevision` and appends a **version history**. Past images and approvals are not silently overwritten.
4. Only share an image after the author **approves** it, the shot is from the latest plan and the source master document is unchanged. Provide a 12–220-character human-written visual caption.
5. A joined article may view this series's current approved references, and explicitly choose one as the source image for a new edit candidate. The image pixel data is only sent to the selected provider on a separate, consented image-edit call.
6. Leaving a series revokes the departing article's gallery images (not its original local assets). Rejecting a shared image or making its source stale immediately hides it from the gallery and prevents new cross-article edits.
7. When series revision or accessible references change during an external generation/edit request, the image/candidate result is not saved. Prior approvals are preserved.

## Data

Four additive SQLite tables:
- `visual_series`: series id, name, revision, serialized visual profile, timestamps.
- `visual_series_versions`: immutable profile revisions.
- `visual_series_members`: one series per project, explicit membership.
- `visual_series_references`: author-curated pointers to previously approved local image assets.

Existing `content_assets` stores image bytes; series records store **pointers**, not duplicate BLOBs. Shared references are resolved only while their source remains the current approved shot. Changing the series profile affects **future** prompts; it does not retroactively certify existing images.

## API

- `GET /api/illustrations/series`: names, revision and member counts only. No gallery image bytes.
- `POST /api/illustrations/series`: `{name,profile:{name,palette,mood,avoid}}`.
- `GET /api/illustrations/series/:id?projectId=...`: series detail, versions and currently approved gallery; requires explicit membership.
- `PUT /api/illustrations/series/:id`: `{expectedRevision,name,profile}`, 409 on stale versions.
- `POST /api/illustrations/series/:id/members`: `{projectId,expectedRevision}`.
- `POST /api/illustrations/series/:id/members/leave`: `{projectId}`.
- `POST /api/illustrations/series/:id/references`: `{projectId,shotId,caption,expectedRevision}`.
- `DELETE /api/illustrations/series/:id/references/:refId`: `{projectId}`; only source article can revoke.
- Existing `GET /api/illustrations/projects/:id` returns `visualSeries` for opted-in members.
- Existing candidate editor recognizes `referenceAssetId` from current shot, prior candidates, or active, explicitly shared same-series references.

## Prompt and privacy boundaries

Series profile and human-authored image descriptions enter future **image prompts** as bounded *untrusted aesthetic metadata*. They are not system instructions, evidence, or a guarantee of matching the reference image. The vision planner does not automatically upload gallery images. Cross-series candidate reference IDs are rejected server-side.

This is still a **local single-user application**, not per-user authorization. The legacy `GET /api/assets/:id/preview` route serves local assets to the local operator; do not expose this to the public internet. Before multi-user deployment, implement authentication, storage ACLs, per-user image access, audit retention, rate limiting, provider spending budgets and encrypted secrets. No actual external model or target-platform copy/paste validation was conducted.

## Tests

`npm test` includes V37 series consent, version history, cross-project refusal, approved-reference-only access, leaving/revocation and concurrent series changes. `npm run check` and Next.js `npm run build` are run in GitHub Actions; see PR #8 checks for the current result.
