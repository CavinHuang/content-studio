# Content Studio V43 — Author image quality evidence and doocs/md image round-trip

**Implementation status:** stacked Draft branch `feat/v43-image-quality-roundtrip`, based on V42. No direct merge into `main`. This remains a **trusted, single-user local SQLite** application. It does not publish to WeChat/Zhihu, rank AI suppliers by actual competence, or bill any models while evaluating images.

## A. Why V43 exists

V32–V42 could plan, generate, compare, approve and map images, but the record of *why an author considers a model output suitable* was not consistent across providers. Additionally, after passing an image Markdown proposal through doocs/md, the saved channel draft might silently lose, duplicate, reorder or replace mapped image URLs. V43 tracks those two risks separately.

### Human rubric, immutable evidence

`GET /api/illustrations/projects/:projectId/shots/:shotId/quality-reviews` returns current image/candidate choices and up to 50 author reviews per image slot, with current/stale flags.

`POST /api/illustrations/projects/:projectId/shots/:shotId/quality-reviews` accepts:

```json
{
  "assetId": "as_<asset-id>",
  "expectedAssetSha256": "<64-hex asset digest>",
  "expectedShotUpdatedAt": "<last-read slot timestamp>",
  "expectedSourceRevision": 1,
  "expectedProfileRevision": 1,
  "ratings": {
    "briefFit": 4,
    "clarity": 4,
    "mobileReadability": 3,
    "styleConsistency": 4
  },
  "riskFlags": [],
  "rightsReviewed": true,
  "factualReviewed": true,
  "recommendation": "recommended",
  "note": "The author observed an appropriate conceptual illustration."
}
```

Rating keys are compulsory, 1–5. `riskFlags` may use `misleading_data`, `fabricated_ui`, `text_errors`, `rights_unclear`, `sensitive_content`, `accessibility`, `other`. Recommendations: `recommended`, `revise`, `reject`. A positive recommendation is rejected unless both manual-review flags are true, all ratings are at least 3 and risk flags are empty. Notes must be 12–600 characters.

Each successful request appends a **new SQLite row**, anchored to the asset SHA256, source revision, current plan, visual-profile revision and shot timestamp. Changing the article, visual style, selected image or approval timestamp makes the prior review *historical rather than current*. The rubric **never changes an image's approval/selection status** and is not an automated factual or rights certification. No prompts, image bytes or API keys are stored in this table.

An author-supplied provider count/mean rating is available **only as a descriptive summary of reviews for that image slot**. It is not a controlled blind A/B experiment. Different images, tasks and prompt versions are not comparable evidence of which model is objectively best. Existing V36 machine visual feedback remains advisory and independent.

### Doocs/md read-only image reconciliation

`GET /api/illustrations/projects/:projectId/image-roundtrip/:channel` checks the **currently saved channel layout** (for `wechat` or `zhihu`).

`POST /api/illustrations/projects/:projectId/image-roundtrip/:channel` accepts:

```json
{
  "markdown": "# Sample article\n\n![Author-approved cover](https://cdn.example.org/cover.png)",
  "expectedLayoutRevision": 0,
  "expectedSourceRevision": 1
}
```

The POST request performs an **in-memory preview** without saving the Markdown. A stale source/layout revision receives HTTP 409. Maximum Markdown length is 250,000 characters. The result contains the SHA256 digest of the submitted document, current revisions, total/expected/matched image count, per-slot matches, issues and warnings, and an explicit `platformVerified:false`. It never fetches external image URLs or sends bytes to a model.

Detected conditions include missing expected images, duplicated mapped URLs, unexpected/unmapped image links, reordered images, missing image approvals or channel mappings, unimported channel layout, stale article/plan and image placement before its paragraph. Markdown fenced code blocks and inline code are ignored. Paragraph anchors that cannot be confidently found, the same image URL intentionally reused by different slots, missing alt text and reference-style image links require manual examination.

The scanner is **conservative and limited**: it supports standard inline Markdown images; it is not a full HTML/Markdown AST or a pixel-diff of third-party editor output. Links loaded only through platform-specific transformations, rich HTML, CSS backgrounds or remote rehosting may require independent review. A `ready` result means only that the *local text and mapped URLs* passed these checks, never that the image resolves in a WeChat/知乎 client.

### Idempotent handoff after saving

V43 also fixes `IllustrationService.handoff()`: a mapped image URL already present in the saved layout is not blindly inserted a second time when an author rebuilds the proposal. For an intentionally reused asset, the service counts existing occurrences. The V43 reconciliation then warns when URL-based placement cannot be unambiguously proven. Rebuilding does not mutate the persisted layout and does not bypass V30/V31 revision review.

## B. UI walkthrough

Open `/illustrations?project=<id>` and go to **V43 · 视觉质量证据与排版图片核对**.

1. After images exist, choose a slot and an existing selected/candidate asset. Review the local preview, select four 1–5 scores, record risk flags and real human-review attestations, enter a specific observation and save. This is a recommendation record, **not approval**.
2. After mapping to WeChat or Zhihu, use the existing V30 layout import in `/compose`. Return to `/illustrations` and click **检查已导回并保存的渠道稿**. This checks stored Markdown rather than regenerating the proposal.
3. Alternatively paste proposed/imported Markdown into the V43 box and click **校验待导回的 Markdown（只读）**. Fix any missing, duplicated or unexpected images in doocs/md, then use V30/V31 review tokens to save the corrected channel draft.
4. Manually check actual doocs output and the target platform's desktop/mobile appearance. Keep V40 channel-specific author-reported platform QA; V43 does **not** replace or auto-certify those checks.

## C. QA and boundaries

```bash
npm test
npm run check
npm run build
npm run test:e2e
```

Node tests cover positive/negative rubrics, immutable history, approval-state invariants, stale asset anchors, zero-cost reads, code-fence/inline-code Markdown image parsing, import confirmation, missing/duplicate/unmapped/reordered images, channel isolation, revision conflicts and idempotent rebuilding after an import. Chromium tests use synthetic article data and a mock local-only image endpoint; they exercise the V43 panel, no-image states and read-only pasted Markdown checking.

**Unverified:** real paid multi-model quality comparisons, images in external doocs/md/WeChat/Zhihu graphical editors, actual CDN reachability, user ownership of rights, semantic truthfulness, mobile accessibility in the deployed platform, and any real publication. Results are local technical findings and author testimony, not platform service-side attestations.
