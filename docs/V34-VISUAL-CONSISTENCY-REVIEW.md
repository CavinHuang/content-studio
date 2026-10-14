# V34 · Illustration Agent — visual identity, bounded fallback and advisory review

## Scope and state

This release builds on V33's multi-provider generation. It is **local-only**, single-user, and leaves image approval and publication with the author. Provider calls are not live-tested without credentials. CI exercises request and response contracts with mocks. `doocs/md` remains an independent editor and no WeChat/Zhihu upload API is claimed.

## End-to-end workflow

1. Draft article and create an illustration plan (`master.document.revision` locked).
2. Set a project visual identity (name, palette, mood, avoid). Reuse another article's identity by explicitly copying it into the current project's profile.
3. Optionally ask the planning LLM for anchored scene ideas (explicit consent). Every image prompt includes the selected visual identity and the V33 provider-specific art-direction additions.
4. Generate an image with one chosen provider, optionally supplying up to two fallback providers. Up to **three distinct provider requests**, each explicitly approved with `allowExternalAI:true`. No automatic retries on a single provider, background calls, unbounded loops or automatic prompt changes. Fallback happens only on 429/502/503/504-like transient errors.
5. Every generation attempt gets an append-only provider/result/elapsed time record. **Elapsed time is not cost or token usage.** Only generic sanitized failure details are saved.
6. A locally generated asset gets a **metadata-only** advisory `needs_human_review` note. If independently authorized, a vision-capable model can inspect the stored image and original prompt and return one of `looks_consistent`, `needs_revision`, `uncertain`. This is an advisory opinion, **not proof of accuracy or licensing**.
7. Author approves/rejects a specific image, manually maps public HTTPS URLs per destination channel and checks the read-only Markdown handoff. V30/V31 content review and real target-platform paste QA remain required.

## API

- `GET /api/illustrations/visual-profiles` — saved per-project profiles for explicit cross-article reuse (local-only).
- `GET /api/illustrations/projects/:id` — existing plan, shots and provider info, now with `visualProfile`, `reviewerConfigured`, per-shot `review` and `attempts`.
- `PUT /api/illustrations/projects/:id/visual-profile` — `{expectedRevision,profile:{name,palette,mood,avoid}}`; optimistic revision; resets latest plan's generated images to `planned`. Existing assets and historic attempts remain preserved. Never silently overwrites old approvals.
- `POST /api/illustrations/projects/:id/shots/:shotId/generate` — `{allowExternalAI:true,provider:'openai',fallbackProviders:['gemini','qwen'],maxAttempts:3}`. Each provider must be configured. Default `maxAttempts:1`; provider errors do not trigger unrequested fallback. Explicit API call; no automatic invoice or spending estimates.
- `POST /api/illustrations/projects/:id/shots/:shotId/review` — `{allowExternalAI:true}`. Requires separate vision reviewer configuration, sends original stored image bytes to reviewer, and records advisory result. Never approves the image; even an already manually approved shot returns to `generated` for renewed approval after this review.

## Provider compatibility

Generation: existing adapters support OpenAI GPT Image via Images API, Gemini/Nano Banana via `generateContent`, Qwen via OpenAI-compatible Images endpoint and strictly allowlisted OSS download. Actual model IDs depend on your provider account and available models; change them in environment variables rather than assuming the example identifiers remain live.

Review: optional **vision-capable OpenAI-compatible Chat Completions** endpoint, not necessarily the same endpoint/protocol as the image generation provider. Supports `image_url` data URL and strict advisory JSON. Gemini-only native generation endpoints are **not** automatically valid reviewer endpoints. For images containing private information, leave reviewer unconfigured or do not consent.

```dotenv
CONTENT_IMAGE_REVIEW_BASE_URL=https://vision-provider.example/v1/
CONTENT_IMAGE_REVIEW_MODEL=your-vision-capable-chat-model
CONTENT_IMAGE_REVIEW_API_KEY=server-only-secret
```

Review results are bounded and validated. The reviewer must not be trusted to assert real-world evidence, copyright clearance, identity authenticity, or platform rendering. V34 never treats its `looks_consistent` verdict as authorization to publish.

## Data and migration

Created lazily on service startup via `CREATE TABLE IF NOT EXISTS`:

- `article_illustration_profiles`: project ID, increasing revision, validated profile JSON, timestamp.
- `article_illustration_attempts`: immutable attempt ID, shot ID, provider/model, outcome, elapsed milliseconds, sanitized error, timestamp.

Existing `article_illustration_shots` gains one nullable-default `review_json` column. Existing V33 tables and assets remain. Plan and shot rows use optimistic source revision and shot updated timestamps. **Backup `data/content-studio.sqlite` before switching branch versions.** Do not run old and new code concurrently against the same SQLite file.

## Security, costs and limitations

- The application must remain bound to localhost; `CONTENT_STUDIO_ALLOW_REMOTE` is not authentication.
- All API keys are server-side. Never place them under `NEXT_PUBLIC_` or commit `.env.local`.
- Image bytes are private and only transmitted for an explicit vision-review call. Planner and generation consent are independent.
- Only fallback providers explicitly listed in an individual request are attempted; no more than three distinct requests per image. **Multiple provider calls can incur multiple charges.** No reliable price estimator is supplied.
- Image model agreement about composition does not establish factual correctness, ability to paste into WeChat, accessibility, licensing, or rights to identifiable persons.
- Existing images can be reused as a visual reference in a **future** image-editing adapter; V34 does not claim inpainting/editing is implemented.
- Dynamic tests use mock provider APIs. No genuine paid OpenAI/Gemini/Qwen/reviewer API call, and no real WeChat/Zhihu visual QA, have been completed as part of this release.
