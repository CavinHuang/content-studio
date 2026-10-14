# Content Studio V40 — Provider contract validation & channel handoff QA

> **Scope:** stacked draft branch `feat/v40-provider-contract-preflight` on V39. Never auto-merge main. The app remains **single-user localhost**; no real model/provider or WeChat/Zhihu login is used in this release's CI.

## What changed

### Safer image provider wire handling

1. OpenAI GPT Image, Gemini Nano Banana and Qwen Image retain their existing provider-specific API shapes. V40 does not silently change configured model IDs or endpoints.
2. HTTP 401/403 and invalid request responses are **permanent errors**. Do not waste paid fallback attempts on bad credentials or bad model/parameters. Transient 408, 425, 429 and 5xx or transport timeout/network failure remain *potentially* retryable. A fallback still requires explicit opt-in and **another V38 budget reservation**. Mock-injected legacy clients that throw an HTTP status continue to work.
3. Invalid JSON, oversized responses and invalid image bytes are never treated as successful generation. OpenAI and Gemini responses must decode to supported PNG/JPEG/WebP signatures. Qwen's expiring download URL must be HTTPS, credential-free and match the **OSS-specific** Aliyun host pattern. Non-image content types and HTML error bodies are rejected. Redirects remain disabled. Returned image assets still pass through `AssetService` validation.
4. `GET /api/illustrations/providers/preflight` locally validates environment presence, endpoint scheme and documented contract type. **It makes zero HTTP calls, consumes zero model requests and does not reveal API keys.** Its `configured` label proves neither real account authorization nor model availability.

### Immutable, author-reported handoff QA

- `GET /api/illustrations/projects/:projectId/handoff-qa/:channel` checks latest master revision, active image plan, approvals, channel URL mappings and exact paragraph placement. No platform request is issued.
- `POST` to that endpoint accepts `expectedSourceRevision`, `expectedLayoutRevision`, `expectedProposalSha256`, four explicit booleans `rightsReviewed`, `uploadConfirmed`, `desktopPasteConfirmed`, `mobilePreviewConfirmed`, and a 12–600-character real observation note.
- Each report is appended to `illustration_delivery_qa`, never overwritten. Passing entries are refused while the current handoff is incomplete. A changed article revision, layout, missing image placement or a changed image URL invalidates `latestCurrent`. A report for WeChat never certifies Zhihu.
- `GET .../handoff-qa/:channel/history` returns immutable recent author reports. Fields explicitly state `authorReported:true` and `platformVerifiedAutomatically:false`. The platform is **not** probed. The system cannot prove the author actually completed the external checks.
- This QA log is not a publication record. It does not change V27 editorial checks or the V30 Markdown diff-and-confirmation flow.

## Local operator workflow

1. `npm run dev`, open `http://127.0.0.1:4312/illustrations`.
2. Click **检查三家供应商配置**. This is an offline configuration preflight only.
3. Create current article plan; generate using an explicitly authorized API call when you are prepared to incur charges. Author approves each image and manually maps its channel-specific HTTPS URL.
4. Choose WeChat or Zhihu, click **检查当前渠道的交接条件**. A complete result means only "ready for manual platform QA".
5. Use **检查并生成带图 Markdown**, copy to doocs/md, and actually paste/test in the target channel (desktop and mobile). Check image rights, text fidelity and image positions.
6. Record *each of four independent observations* and an explanation, including failures. A passing report is author testimony for that **exact current proposal** and must be redone if the content changes.

## Test matrix and limitations

Automated Node/HTTP tests mock provider network requests. Coverage includes:
- Zero-network preflight, secrets absent from JSON output.
- OpenAI 401 does not invoke fallback, transient 429 invokes explicitly allowed fallback once and counts both reservations.
- Invalid JSON/invalid base64/magic bytes cannot cascade into silent retry.
- Qwen URL rejects arbitrary aliyuncs.com services and credentials; accepts the documented OSS-style temporary URL; rejects HTML content served at a trusted host.
- Handoff rejects passing reports with unapproved images; approved-and-mapped outputs can receive a user-reported passing record; changes to mapping invalidate its exact SHA256 anchor; QA is isolated by channel.

Run:
```sh
npm test
npm run check
npm run build
```

**Not tested with real money or platform credentials:** live API keys, provider model entitlement, provider billing, real timeout/network variance, browser click-through/E2E and actual WeChat/Zhihu paste/mobile rendering. Separate, *explicitly approved* metered tests are required. The QA history is local SQLite only and must be backed up. This is **not** an authenticated multi-tenant SaaS deployment.

## Relevant official protocol references (reviewed October 2026)

- OpenAI Images API: https://platform.openai.com/docs/api-reference/images
- Gemini current Nano Banana generation and legacy generateContent docs: https://ai.google.dev/gemini-api/docs/image-generation and https://ai.google.dev/gemini-api/docs/generate-content/image-generation
- Qwen Image OpenAI-compatible synchronous generation/editing and time-limited download URLs: https://www.alibabacloud.com/help/en/model-studio/qwen-image-generation-and-editing-api-reference
