# Content Studio V38 — External model request budgets

V38 extends the newer V37 **opt-in visual series PR #9**, NOT `main`. Local, trusted single-user Next.js + Node 22 + SQLite remains the deployment boundary. Feature branch: `feat/v38-image-request-budgets` (stacked on `feat/v37-visual-series-library`).

## User flow

1. Open `/illustrations` and select an article; the left panel shows the UTC day, requests consumed, remaining allowance and in-progress reservations.
2. Default allowance is **12 external model request reservations per article per UTC day**. Set a different allowance, **1–100**, using the editor control; changes use `expectedRevision` and reject stale writes (HTTP 409).
3. Image planning, generation, fallback attempts, reference-guided edits, standalone vision reviews and candidate comparisons share this quota.
4. The quota is reserved and committed **before** calling the external provider. If the daily cap is reached, the request fails with **HTTP 429** and the provider is not called. A fallback attempt must reserve again, so a single user action can consume multiple reservations.
5. The ledger intentionally stores only project, slot, provider, request type, UTC day, start/end timestamps and `reserved/success/failed` states. No API key, source prompt, generated image bytes, cost, or inferred billing figures are saved.
6. Requests that failed or remained `reserved` after a crash **stay counted**. Actual provider charging is not observable by this app, so the ledger means *requests reserved*, not successful generations, total dollars or confirmed billable invoices.
7. Changing the cap below the current usage is allowed, but further calls are blocked until a new UTC day or the author raises the cap. No automatic publication, image approval, or sending data occurs merely from adjusting the limit.

## API contracts

| Method | Route | Behavior |
|---|---|---|
| GET | `/api/illustrations/projects/:projectId/budget` | Day summary and last 15 reservations |
| PUT | `/api/illustrations/projects/:projectId/budget` | `{expectedRevision,dailyLimit}` — update cap via optimistic concurrency |
| GET | `/api/illustrations/projects/:projectId` | Existing payload gains `requestBudget` summary |

Only valid local editorial projects may use these endpoints. The existing localhost/Origin guard remains enforced. This is **not** authenticated multiuser accounting or a spending guarantee. Providers can charge different amounts per request or charge for failures, and planning/vision may cost differently from generated art.

## Verification and limitations

- Tests: `test/image-request-budget-v38.test.mjs` exercises UTC midnight rollover, stale budget revision, insufficient consent, exhausted quota, fallback stopping, edits sharing the cap, and no plaintext prompts/images in the ledger.
- Run `npm run check && npm test && npm run build` in Node 22.13+ with Next.js installed; use CI as the build source of truth when external packages are unavailable locally.
- New migrations are additive: `image_request_limits` and `image_request_ledger`. Existing article and evidence revisions remain untouched.
- Live OpenAI GPT Image / Nano Banana / Qwen Image requests and WeChat/Zhihu image pasting still need explicit keys, billing consent and platform QA. No live paid tests are implied by successful mock/unit/Next build.
- Reserving *before* dispatch is a conservative cap on external attempts, not atomic exactly-once provider billing. An infrastructure retry outside the application may still bill separately.
