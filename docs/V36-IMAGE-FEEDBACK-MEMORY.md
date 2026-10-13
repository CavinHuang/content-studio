# V36 · Reference comparison, author feedback and scoped visual memory

Status: implemented in `feat/v36-image-feedback-memory`. Builds on V35 PR #6 (stacked; do not merge directly into main before lower branches). **Local single-user proof of concept only**. No actual paid calls to image/vision providers, WeChat, or Zhihu have been verified.

## Why

V35 generated candidate images without measuring whether the revision followed the author's instruction or retaining the author's reasons for choosing a visual direction. V36 introduces **advisory** image comparison and explicit, scoped, author-controlled preference learning, rather than automatically accepting a highly scored image.

## UI flow

1. Author chooses a current/reference image and specifies a requested edit, creating a candidate with its own immutable asset.
2. UI shows side-by-side images and the edit instruction.
3. Optional: author authorizes sharing **both** images with a configured vision model. The reviewer reports `verdict`, `instructionFit`, `styleConsistency`, `reason`, `issues`; all are advisory and never change the selected/approved image.
4. Author records one immutable comparison judgment per candidate (`candidate_better`, `reference_better`, `needs_revision`) and a concrete note (10–320 characters).
5. `remember` is opt-in per note. Only remembered notes from the **same project**, most recent six, are appended as lower-trust creative preferences to subsequent generation/edit prompts. They do not alter historical prompts, already approved images, article versions, or other projects.
6. Selecting a candidate still requires a separate decision, after which explicit author approval is required before channel mapping.

## Endpoints

All remain localhost-only and reuse existing Next.js App Router dispatch, with validation/404/403/409/422/502 guards.

- `POST /api/illustrations/projects/:projectId/shots/:shotId/candidates/:candidateId/comparison` – `{allowExternalAI:true, expectedUpdatedAt}`. Transmits two bounded image byte buffers only with explicit consent. Persists assessment snapshots in `article_illustration_comparisons`. Returns 201 with advisory metadata.
- `POST /api/illustrations/projects/:projectId/shots/:shotId/candidates/:candidateId/feedback` – `{expectedUpdatedAt, rating, note, remember}`. Persists one immutable author feedback record per candidate, returns 201 with scoped memory. 409 for duplicates/stale source.
- Existing `GET /api/illustrations/projects/:projectId` now returns `comparatorConfigured`, `visualMemory.preferences`, and per-candidate `referenceAsset`, `comparison`, and `feedback`.

## Database migrations

The service constructor creates two additive tables (no destructive migrations):

- `article_illustration_comparisons(id,shot_id,candidate_id,reference_asset_id,asset_id,assessment_json,created_at)` – append-only advisory assessments. Validated external data only; image bytes remain in the existing asset store.
- `article_illustration_feedback(id,project_id,shot_id,candidate_id UNIQUE,rating,note,remember,created_at)` – immutable human feedback with per-note opt-in to preference memory.

## Privacy and safety

- `CONTENT_IMAGE_REVIEW_BASE_URL`, `CONTENT_IMAGE_REVIEW_MODEL`, `CONTENT_IMAGE_REVIEW_API_KEY` are read server-side only. Uses OpenAI-compatible chat completions **with two image_url data parts**; not all vision providers support this schema. User must separately consent to transmitting both images on each review request. HTTPS enforced except localhost; redirects rejected; max 6 MB per image, 45 second timeout, max 24 KB response.
- Prompt injection within reference images or human notes is untrusted. Validation permits bounded author notes only. Preference notes are explicitly demoted below factual/safety constraints when added to the future *image* prompt.
- Vision comparison is not independent factual verification, copyright certification, usability signoff or author approval. A favourable verdict never publishes, approves, selects, or even changes the current illustration.
- Feedback is scoped to project and remembered only on explicit opt-in. It is not sent to a model until a separate consented subsequent generation/edit call.
- Uses master revision, candidate project/shot membership, candidate profile revision, image timestamps, and inflight controls to reject stale or concurrent decisions.
- If this project is later exposed publicly, add authentication, access control, rate limits, provider budget limits, audit retention and per-user preference isolation **before** production deployment.

## Verification

`npm test` (150/150) and Node syntax checks passed in the local environment. Real vision provider and target platform tests were not performed without API keys/accounts. GitHub Actions Next.js build must be checked against the V36 PR head separately.
