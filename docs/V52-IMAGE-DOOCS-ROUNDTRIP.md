# V52 — Image mapping drift and real doocs/md image acceptance

**Branch:** feat/v52-image-doocs-roundtrip. Stacked Draft based on V51 PR #23 → V50 #22 → V49 #21. Nothing is merged to main.

## What changed

Content Studio now retains prior channel image URLs in an additive SQLite table named content_asset_mapping_history. Each actual URL replacement records the old and new URL, asset ID, channel and timestamp **atomically** with the mapping update. Editing a note without changing its URL does not add a false history event. History is channel-specific and survives SQLite restart.

A read-only image audit is available at GET /api/composer/projects/:id/:channel/image-audit and on /compose beside the actual doocs handoff. The author can press **复查图片链接** after changing a mapping. The audit distinguishes:

- current_mapping: saved Markdown URL equals an asset's current mapping
- stale_mapping: saved Markdown URL matches the historical mapping of an asset whose current channel URL is now different
- unresolved_asset_token: an asset:// marker is still in the Markdown
- external_unverified: another external URL without a known local mapping, requiring manual checking

Existing Markdown is **never** automatically overwritten when a mapping changes. Existing mappings replaced **before V52** cannot be reconstructed retrospectively. The audit extracts Markdown image syntax while excluding code fences and inline code; other image syntaxes are not automatically certified.

Every read-only report explicitly declares networkCalls=0, platformVerified=false, cdnReachabilityVerified=false. A mapped URL is not evidence that the underlying file exists on the public Internet.

## Tests — genuine editor, synthetic CDN

Run:

    npm run test:images:v52
    npm run build
    docker compose -f docker-compose.doocs.yml up -d
    npm run test:doocs:real
    docker compose -f docker-compose.doocs.yml down

The real doocs/md:2.1.0 Docker image runs locally on 127.0.0.1:8800. The Next.js test app uses a separate disposable SQLite.

1. Create a synthetic article; upload a real PNG byte array into the Content Studio asset library and verify preview byte equality.
2. Check that the WeChat channel URL must be manually mapped before preparing the Markdown; an absent Zhihu mapping is not silently accepted.
3. Resolve the local asset token to a synthetic HTTPS URL; save Markdown using the revision-bound review token and copy from the actual browser UI.
4. Paste into real doocs CodeMirror; verify the browser decodes and displays the image in the real HTML preview. **The HTTPS URL is intercepted by Playwright and given synthetic local PNG bytes. The public CDN is never contacted or validated.**
5. Export a Markdown file through doocs's actual File → 导出 .md menu, inspect the downloaded contents, review and reimport through Content Studio's existing API.
6. Change the channel image URL mapping, verify new preparations use the new URL but the saved Markdown is unchanged; trigger the new warning in the composer.
7. Confirm all these steps remain local-only and do not mark publication or external platform verification as passed.

The normal Chromium suite separately checks user-visible current-to-stale URL warning after the author changes a mapping. The V52 suite is additionally run separately in CI along with V45–V51 gates and the Next production-process restart smoke.

## Safety and release limits

- V52 never uploads an image to a real CDN or logs into WeChat/Zhihu. It does not invoke paid image generation or billed model endpoints.
- Real image reachability, permissions, copyright, target-platform acceptance and mobile appearance require a separately authorized manual test on genuine devices/accounts.
- A fresh V45 WAL-consistent database backup is required before running new code against real private data. The additive table creation does not replace an operational rollback or offsite encrypted backup.
- External deployment hooks cannot be inspected through the available GitHub connection. Review any merge-to-main auto-deploy impact before integrating the Draft chain V49 → V50 → V51 → V52.

Passing the synthetic CDN proxy test proves that a browser can render the controlled fixture in the real editor. It **does not** prove that the public host is live.
