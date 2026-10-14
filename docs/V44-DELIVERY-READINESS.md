# Content Studio V44 — Unified Article Delivery Readiness

> Stacked draft branch on V43 PR #15. Keep the current five-item creator navigation. One local page aggregates delivery evidence; it does **not** make a publishing decision or call outside services.

## New entry

Open `/delivery?project=<ep-id>&channel=wechat` or `channel=zhihu`. The **发布准备** screen now links to `/delivery`. The same project and its two channels are evaluated independently. No hidden auto-repair is performed.

The UI and `GET /api/delivery/projects/:projectId/:channel` evaluate six steps from *existing* domain services. Every step has a local action link and a precise blocker code:

| Stage | Evidence | What blocks local delivery |
| --- | --- | --- |
| Content | master/channel docs, current revisions | Empty document, unreviewed master update, outdated channel layout |
| Evidence | channel claims and precision-correction tasks | Unmatched/research-stale anchors, unfinished correction tasks |
| Editorial | four independent author booleans | Missing factual, privacy, rights or real-layout confirmation |
| Images | V39 queue, current illustration plan, approvals, V43 quality ledger, V42 local image diagnostics | Stale plan, jobs pending, unapproved image, missing channel URL or current favorable *human* quality review |
| Markdown | V30 saved layout and V43 read-only image reconciliation | Layout not imported, missing/extra/duplicated/reordered or unanchored image |
| Platform images | V40 immutable author report tied to current proposal | No current author-reported pass, or mapped handoff not ready |

The aggregated `decision=ready_for_author_final_review` means only **local checklist satisfaction**; it **never** means a live channel was reached or content was published. `published=false`, `platformVerified=false` and `readOnly=true` are returned. No provider keys, image bytes or raw article text are returned in the aggregate. Technical image dimension warnings remain advisory: they do not silently override explicit human quality records. Unlinked paragraph evidence is a warning, not a declaration of factual proof.

### Text-only articles: explicit waiver, never silent pass

Without a plan, the image stage blocks until the author either creates an illustration plan or records a deliberate no-image decision:

```http
POST /api/delivery/projects/:projectId/wechat/no-images
Content-Type: application/json

{
  "expectedSourceRevision": 1,
  "expectedChannelRevision": 1,
  "expectedLayoutRevision": 1,
  "reason": "This specific editorial draft is intentionally text-only."
}
```

Requirements: explanation length 12–400, all three revisions match, **no illustration plan exists**, and the saved channel Markdown contains no inline/reference/HTML images. Every decision is append-only in SQLite, scoped to that project, channel and those revisions. On a content/layout change, it is stale. A waiver **only skips image-specific stages**; it does not bypass manual editorial checks or importing a real channel layout.

### Immutable author delivery snapshot

Once every required stage is satisfied, the author can record an audit snapshot by acknowledging that no platform verification occurred:

```http
POST /api/delivery/projects/:projectId/wechat/snapshots
Content-Type: application/json

{
  "expectedFingerprint": "<64-character current readiness digest>",
  "note": "I checked the local evidence, images and channel layout and will now manually publish.",
  "acknowledgeLocalOnly": true
}
```

The server recomputes the readiness fingerprint inside an SQLite write transaction. An outdated digest returns **409**, unresolved steps return **409**, missing explicit acknowledgement returns **403**. Each successful snapshot is immutable and includes only channel revision metadata and stage outcome codes—not article text, image content, API keys, or remote platform cookies. It is **an author attestation, not a publishing event**.

Read snapshots with `GET /api/delivery/projects/:projectId/:channel/history` (up to 40). Older entries remain available and are visibly marked stale when the digest changes. No automatic email, posting, scheduling or background review is triggered.

## Required manual workflows remain unchanged

1. Use `/editor` to verify factual source claims, privacy and reuse rights.
2. Use `/illustrations` to generate with explicit external model permission, review and approve images, record their quality evidence, upload to the chosen channel and record its image URL.
3. Use `/compose` / doocs/md to author and import the final channel Markdown with the normal V30/V31 text-diff approval. The V43 image reconciliation is read-only and must pass.
4. Inspect image rendering/paste on the *actual* WeChat or Zhihu desktop/mobile platform; record the V40 author-reported QA. Do not claim API-confirmed results.
5. In `/delivery`, inspect each stage and record an immutable author readiness snapshot. Perform the actual publication **outside** this application and separately record the author-reported publication URL where supported.

## Verification

```sh
npm test
npm run check
npm run build
npm run test:e2e
```

Automated Node and Chromium coverage includes unprepared article states, channel isolation, explicit no-image eligibility and invalidation, stale fingerprints, immutable author snapshots, image plan and V43 quality requirements, six step links, responsive 390px layout and no false platform publishing claims.

This application is still a trusted single-user, persistent `node:sqlite` localhost application, not authenticated multiuser SaaS. No metered model call, live doocs/md/WeChat/Zhihu test or real platform publication is authorized by V44. A successful CI cannot certify the factual content of a user's article or the real appearance of third-party platforms.
