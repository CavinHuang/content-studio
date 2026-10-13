# V29: Mature WeChat editor instead of custom paragraph authoring

## Decision

Use **doocs/md** (standalone Vue 3 application, WTFPL license, https://github.com/doocs/md) for authoring/formatting and WeChat-compatible copy. Next.js owns authoring project metadata, sources, research evidence, reviews and an explicit Markdown handoff. The app does **not** claim a built-in doocs/md React component or automatic two-way editor SDK.

## Routes

- `/compose`: main authoring / handoff workspace. Copy/download Markdown from the selected WeChat/Zhihu channel, launch locally hosted doocs/md, and explicitly import the resulting `.md` as a new immutable layout revision.
- `/editor`: read-only evidence snapshots, citations, precise corrections, independent channel checks and legacy inspection.
- `GET /api/composer/projects/{id}/{wechat|zhihu}`: source + last saved layout state.
- `PUT /api/composer/projects/{id}/{wechat|zhihu}`: explicit save with optimistic expected layout+source revision; on success resets that channel's review checklist.
- `GET .../history`: saved layout revision metadata.

## Risk boundaries

1. No automatic cross-origin code injection or clipboard scraping. Pasting Markdown into doocs/md is a user-initiated operation.
2. Editorial layouts are stored in separate `editorial_layout_drafts` and `editorial_layout_history`; V27 paragraph evidence remains anchored to the original precision documents. **Do not treat modified Markdown as proven by the old citations.**
3. Saving a layout resets the channel approval state and the author-reported publication flag for the working revision, while old reported publication history is retained. Old plain HTML export is blocked after first layout handoff.
4. The returned Markdown is NOT equivalent to a live WeChat published article. Validate actual target editor paste, images, code/table styles and rights.
5. `NEXT_PUBLIC_DOOCS_MD_URL` may point to a self-hosted editor. Default is localhost, not an uncontrolled external third-party. Using external internet services requires explicit user acceptance of the privacy implications.
6. Doocs provides theme/editor functionality and handles its own media; our project does not access, proxy or store doocs media credentials.

## Limits and next work

- No full roundtrip rich-document AST or span-level citation synchronization yet. Any facts changed in the formatter must be re-reviewed before publishing.
- The embedded view is optional and requires a locally accessible doocs origin that permits framing; separate-tab mode is supported by default.
- Next build/React hydration and actual clipboard interoperability have not been tested here due to npm registry DNS restrictions.
- Next iteration: proper canonical block AST bridging Markdown and precise evidence, media attachment workflow, and real WeChat/Zhihu paste tests.
