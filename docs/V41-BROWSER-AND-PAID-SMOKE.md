# Content Studio V41 — Browser E2E and metered provider acceptance

**Status:** stacked Draft PR on V40, not main. Trusted single-user localhost only. This iteration adds a reproducible browser test suite and a one-shot *optional* real-provider acceptance command. CI **never** pays for model requests or accesses external publishing accounts.

## A. Browser E2E (actual Chromium, fake image provider)

```sh
npm install
npm run build
npx playwright install chromium
npm run test:e2e
```

Playwright config starts the built Next.js app on `127.0.0.1:4312`, provides an ephemeral SQLite database under the host OS temp directory, and overrides configured image keys with a **synthetic key** and a loopback-only URL at an unused port. No production DB, keys or image bytes enter the test. The E2E runner starts `npm run start` itself, so **stop** an existing app on port 4312 before running; `reuseExistingServer` is intentionally `false`.

E2E scenarios:
- Create a synthetic article and plan through the actual HTTP API; open the `/illustrations` UI in Chromium and run the free local provider preflight. Check that consent warnings appear and V38 model budget remains zero.
- View channel handoff readiness with unapproved photos: it must not mislabel unapproved images as ready for publication.
- Use the actual `/illustrations/queue` interface, select an article, acknowledge consent and enqueue images. Verify persisted queued jobs without model dispatch; cancel one and confirm that **zero** daily budget was used.
- Open the manual QA panel at a 390-pixel mobile viewport and confirm author checks remain available but are not treated as auto-verified platform proof.

CI automatically runs `npm test`, `npm run check`, `npm run build`, `npx playwright install --with-deps chromium`, and `npm run test:e2e`. Failure traces and screenshots are available as short-retention workflow artifacts. The browser suite exercises **our local UI only**, not the WeChat, Zhihu or doocs/md web editors.

## B. Optional, single-request, PAID provider smoke

Default invocation sends **zero** outbound requests:

```sh
npm run smoke:image -- --provider=openai
npm run smoke:image -- --provider=gemini
npm run smoke:image -- --provider=qwen
```

To deliberately spend up to **one billable image request**, set an appropriate key and model and explicitly enable it. No fallback, no retries, no vision review, no text planning, no publishing, no source article ingestion, no persisted images.

On macOS/Linux:

```sh
export CONTENT_IMAGE_OPENAI_API_KEY='YOUR_KEY_FROM_PROVIDER'
export CONTENT_IMAGE_OPENAI_MODEL='AN_IMAGE_MODEL_ENABLED_FOR_YOUR_ACCOUNT'
export CONTENT_STUDIO_PAID_SMOKE_CONSENT='I_ACCEPT_ONE_BILLABLE_IMAGE_REQUEST'
npm run smoke:image -- --provider=openai --max-requests=1 --execute
```

On Windows PowerShell:

```powershell
$env:CONTENT_IMAGE_OPENAI_API_KEY = 'YOUR_KEY_FROM_PROVIDER'
$env:CONTENT_IMAGE_OPENAI_MODEL = 'AN_IMAGE_MODEL_ENABLED_FOR_YOUR_ACCOUNT'
$env:CONTENT_STUDIO_PAID_SMOKE_CONSENT = 'I_ACCEPT_ONE_BILLABLE_IMAGE_REQUEST'
npm run smoke:image -- --provider=openai --max-requests=1 --execute
```

Replace `openai` with `gemini` or `qwen` and use that provider's `CONTENT_IMAGE_GEMINI_* / CONTENT_IMAGE_QWEN_*` configuration. Use an actual permitted model ID and same-region Qwen endpoint. **This command has not been run against a real paid provider in CI.** It has been tested using an injected fake image generator.

The harness creates a synthetic test article in `:memory:` SQLite, enforces a local limit of exactly one reservation, executes only one `illustrations.generate` attempt, and outputs a sanitized JSON summary with provider, model, elapsed milliseconds, result status, asset MIME/bytes and reserved requests. The internal image is discarded when the process ends. The actual provider charge must be checked in the provider dashboard: one reserved request does **not** equal one final invoice item. A transient failure still consumes the reservation; the command never automatically retries.

### Acceptance checklist for each paid provider

| Check | Automatic or manual? |
| --- | --- |
| Request route, protocol, documented payloads | Mock HTTP tests; real behavior only after paid smoke |
| Credential and enabled model produce image | Live smoke, **not yet performed** |
| Download succeeds without provider URL leakage | Paid smoke, where applicable |
| PNG/JPEG/WebP magic, asset size, local storage | Automated validation |
| Time/cost consistency vs actual provider dashboard | **Manual** verification required |
| Text-free factual fidelity, rights and misleading figures | **Manual** inspection; smoke does not persist images |
| Visual quality vs alternative providers | **Manual** follow-up; not inferred from 1 sample |

## C. Publishing handoff / doocs.md manual acceptance

For each channel and article:
1. Confirm current source and layout revisions; approve every candidate image. Upload only author-cleared images to the target platform and record their resulting public HTTPS URLs.
2. Run **检查当前渠道的交接条件** in `/illustrations`; map/unplaced issues must be resolved. The output is an **internal readiness check**, not a claim of working platform paste.
3. Open the real doocs/md editor (separate service) to format the proposed Markdown. Copy into the real WeChat desktop editor and separately test Zhihu. Save a mobile-preview screenshot and confirm all images resolve, are legible and placed at intended paragraphs.
4. Explicitly submit the four manual QA checks and observations to the immutable V40 log. A changed image URL, layout or source invalidates the prior passing report. The report records **the author's claim**, not an automatic proof or publication.
5. Import the edited Markdown using V30/V31 diff review; manually re-approve revisions. Keep original export/review history immutable.

**No platform credentials, screenshot evidence or invoices were available in this development pass. Therefore none of these real-platform acceptance steps are claimed completed.**

## D. Risk boundary

This is still a local desktop companion service, not multiuser production infrastructure. There is no browser-test replacement for actual delivery, no guarantee that provider cancellation can reverse charges, no automated billing reconciliation, no per-tenant authentication, and no live social-media publishing. Secrets belong in local environment only; never commit key values, image databases, screenshots of private content or billing statements to GitHub.

## E. Troubleshooting

- If browser tests fail to start, stop any existing process using port 4312 and run `npm run build` again.
- On Linux install Playwright dependencies with `npx playwright install --with-deps chromium`; macOS/Windows use `npx playwright install chromium`.
- CI failure artifacts include browser screenshots/traces **of synthetic fixtures only**. Real screenshots and credentials should never be uploaded to public CI.
- `CONTENT_STUDIO_ALLOW_REMOTE=1` is not authentication: do not use this app on a public host.
