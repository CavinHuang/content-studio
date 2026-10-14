# Content Studio V42 — Local image audit, handoff correctness, browser visual regression

**Status:** separate stacked draft change on top of V41. No automatic merge into main. Local single-user Node/SQLite only.

## What is actually verified

V42 adds a **read-only, offline technical audit** at:

`GET /api/illustrations/projects/:projectId/technical-audit?channel=wechat|zhihu`

It reports:
- Current illustration-plan ID and source/layout revision; matching V40 handoff proposal SHA256 and readiness issues.
- Per shot: role, human approval status, channel URL mapping presence, and current selected image and saved candidate-image metadata.
- Per image: MIME, local bytes, real header-derived width/height (PNG IHDR, JPEG SOF or WebP VP8X/VP8L/VP8), approximate aspect ratio, alternate-text presence, expected editorial ratio (16:9 for cover, 3:2 for section), and low-resolution / out-of-aspect advisory flags.
- The existing provider/model labels for **already stored** assets. No new provider calls, no download of remote channel image URLs, no automatic model score, no visual ranking, and no inference of factual accuracy or rights clearance.
- Read-only audit does **not** count against V38 daily model budget or change V39 queue status.

The audit is exposed in `/illustrations` under **V42 · 离线图片技术体检**. Results are refreshed on explicit user request and reset on article/channel switches. Current local candidate links point to existing private same-origin preview URLs, not publicly hosted media.

**Important:** These are binary header and composition-target checks, not image-quality or copyright judgments. A technically acceptable JPEG/PNG/WebP may be deceptive, inaccessible or unacceptable to an editor. The audit explicitly marks `semanticVerified=false`, `platformVerified=false` and `paidComparisonsPerformed=false`. Differences in format, file size and shape **cannot** establish which of OpenAI/Nano Banana/Qwen is aesthetically better; cross-model evaluations require comparable prompts, paid calls and independent manual review.

## Markdown handoff fix

`src/illustrations.mjs` now escapes parentheses in author-mapped HTTPS image URLs to `%28` and `%29` when generating the Markdown proposal, and replaces brackets, backslashes, CR and newline characters in alt text with plain spaces. Without escaping, a valid URL containing a parenthesis can prematurely terminate a Markdown image token and break doocs/md or channel copy/paste. No channel draft is automatically modified. V40 human QA remains bound to the current proposal hash and becomes stale after mappings change.

## Browser layout regression (Chromium, no paid API)

`e2e/visual-handoff-v42.spec.mjs` adds checks for both 1280 px desktop and 390 px mobile viewport. It captures the **actual browser PNG bytes** of the static navigation header before and after running a local image audit, checking that the header pixels are unchanged by this read-only interaction. It checks responsive container and header bounding boxes are inside the viewport, and that each screenshot is a valid PNG with plausible dimensions. Another browser test verifies that changing from WeChat to Zhihu clears previous channel-specific technical results.

This **is not yet a committed golden pixel-baseline system**: cross-platform typography, OS font rendering and visual design changes still require human UI review. It is a deterministic screenshot-stability and geometry regression test, designed to fail on obvious layout shifts rather than silently regenerating and accepting snapshots. Playwright E2E uses synthetic article text and fake loopback model configuration.

## Verification

```bash
npm test
npm run check
npm run build
npm run test:e2e
```

Node tests cover image header parsing (PNG/JPEG/WebP), low-resolution/ratio/alt warnings, read-only provider metadata audit and V38 zero-spend invariants, and Markdown escaping with V40 proposal digest matching. CI runs all tests and actual Chromium; screenshots and traces are archived on browser failures.

## Still requires manual / real environment

1. Real paid OpenAI / Gemini / Qwen outputs, including any actual currency charge, remain untested unless a human explicitly runs the V41 **single-call consent-gated smoke tool**.
2. Browser screenshot checks here do **not** prove image attractiveness, accessibility or semantic fidelity. Human art review and rights check remain essential.
3. The system does **not** log in to doocs/md, WeChat or Zhihu. Export, manual upload, real paste, desktop/mobile preview and V40 author-reported checks are still required.
4. Do not publish or store private screenshots or credentials in GitHub/CI. Keep SQLite in local persistent storage and back it up before merging stacked migrations.
