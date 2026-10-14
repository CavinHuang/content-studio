# V37 · Series style assets, opt-in sharing and reference-gallery reuse

**Implementation status:** source integrated; tests cover local domain rules. **Scope:** local, single-user Next.js + SQLite. V37 is a stacked PR on V36, and does not change `main` until lower PRs are merged. Do not expose this app to an untrusted network.

## Product contract

A series is a named, versioned creative identity shared between explicitly enrolled articles. Previously V36's feedback memory was scoped to one article; that remains unchanged. V37 permits **additional, separately opted-in series preferences** and **approved artwork references**, revocable by the source article (or series owner). No image asset is automatically shared merely because an article joined a series.

1. An author creates a series from one article, or explicitly joins an existing series. A project can have at most one current series.
2. The series creator edits a four-field visual profile. Each edit adds an immutable snapshot (`visual_series_versions`) and increments a revision. It never silently changes member articles.
3. A member applies the current series profile to their article with both **expected series revision** and **expected article profile revision**. This deliberately resets image approvals and requires regeneration/review. Prompt generation will use the newly adopted style; no old approved image is reused automatically.
4. To add a reference, a member must have an **approved image from the latest illustration plan and current master revision**, then explicitly choose it, provide a purpose note and opt in. Other members can see and select this exact reference in the image-editing form, which still requires the existing per-call `allowExternalAI` consent before sending bytes outside the device.
5. Source/owner can revoke a reference. A source article revision, new illustration plan, changed visual profile, image rejection or candidate replacement also invalidates it. API validates permission both before image editing and **after the external call**, and before selecting a candidate. Candidate history remains but revoked series reference previews are redacted from its nested payload.
6. Author memory is **not** shared automatically. An individual V36 feedback record must already have `remember=true`, then its owning article must explicitly publish that record to the series. Revocation stops future prompt reuse; each new external image request still requires normal model consent. Prompts treat human preferences as untrusted creative guidance.
7. Leaving the series revokes that article's shared references and memory. The series owner cannot leave while any other member remains.

**Privacy limitation:** existing generic `/api/assets`, `/api/assets/:id/preview`, and `/api/illustrations/visual-profiles` are designed for a trusted single-user localhost app, not per-tenant access control. V37 enforces business-scoped series membership in the series and cross-image-edit interfaces, **not** full authentication or cryptographic segregation. Do not claim this is multi-user private hosting. Do not make it publicly accessible until authentication, asset ACLs, secret vault and CSRF protection are in place.

## API

All routes extend `lib/api.mjs` and use the same localhost-only Origin/Host restrictions:

| Method | Path suffix after `/api/illustrations/projects/:projectId/series` | Action |
|---|---|---|
| GET | `/` | Series selection metadata, current membership and member-only series gallery |
| POST | `/` | Create `{name,profile}` and join (201) |
| PUT | `/` | Owner updates `{expectedRevision,name?,profile}` with optimistic concurrency; new immutable version |
| POST | `/join` | `{seriesId}` explicitly joins an existing series |
| POST | `/leave` | Leaves; retracts the article's reference sharing and preferences |
| GET | `/history` | Member-only immutable series profile versions |
| POST | `/apply` | `{expectedSeriesRevision,expectedProfileRevision}` copies style into member article; no cross-article automatic edits |
| POST | `/references` | `{assetId,note}` shares a currently approved local artwork |
| DELETE | `/references/:referenceId` | Source or owner revokes the shared artwork |
| POST | `/preferences` | `{feedbackId}` explicitly shares one V36 remembered feedback record |
| DELETE | `/preferences/:preferenceId` | Source or owner revokes shared feedback |

Existing `POST /api/illustrations/projects/:projectId/shots/:shotId/candidates` additionally accepts a series-shared `referenceAssetId`, only when the caller is a current member and the source artwork remains current and approved. It will create a **candidate**, not an approved image. The candidate `reference_is_shared` column marks its permission context and prevents a revoked reference becoming visible merely because an image hash was deduplicated elsewhere.

## Schema changes

Additive SQLite tables: `visual_series`, `visual_series_versions`, `visual_series_members`, `visual_series_references`, `visual_series_preferences`. Existing `article_illustration_candidates` receives nullable-safe `reference_is_shared INTEGER NOT NULL DEFAULT 0`. No original tables or article snapshots are deleted; old candidate entries default to the original local-only reference behavior.

References store asset IDs, not copied image bytes. Image data remains in `content_assets`; provider calls remain server-side and require consent, with no automatic external upload or publication.

## QA and real-world validation

- Local `npm test`: 159 / 159 (including 9 new V37 domain/API tests).
- `npm run check`, Node syntax and JSX syntax parser: passed locally.
- GitHub CI Next.js build: check workflow for V37 branch after push.
- Real provider image-to-image, WeChat/Zhihu pasted image rendering and browser-authenticated multiuser isolation: **not tested**.

Edge cases covered: double join, owner-only revision, stale style version, cross-series reference access, reference revocation before selection, revocation during API call, explicit external AI opt-in, shared memory double opt-in and revocation, leave semantics, master revision invalidation, and automatic removal of invalidated author approvals.
