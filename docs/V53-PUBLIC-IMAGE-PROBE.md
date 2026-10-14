# V53 — Author-initiated public image response checks

**Stacked Draft:** `feat/v53-public-image-probe-gate` atop V52 PR #24 (V51 #23 → V50 #22 → V49 #21). This stage does not merge to main, publish an article, upload an image, or contact a paid image model.

## Problem and feature

V52 proved a *locally stored* image URL was preserved when handed to doocs/md. It deliberately intercepted a synthetic CDN response, which means V52 did **not** check a real public image URL. V53 adds a limited network observation that can be invoked by an informed author, without turning Content Studio into an arbitrary URL fetcher or SSRF proxy.

On /compose, the user selects their project/channel and sees current image mapping information. To check remote responses, they must explicitly check **我同意本次向当前稿件已映射的公网 HTTPS 图片地址发送最多 3 次有限 GET 请求** and press **检查公网图片响应**. The checkbox resets after running or refreshing the mapping. No DNS or HTTP request occurs just from opening the compose page.

The new API is:

```http
POST /api/composer/projects/:projectId/:channel/image-network-check
Content-Type: application/json

{"expectedLayoutRevision":1,"acknowledgeExternalRequests":true}
```

The URL list comes from **saved Markdown + current manual asset mappings in SQLite**, not from a request-supplied URL or arbitrary HTML. Historical/stale image links and unregistered external images are excluded. Requests are deduplicated and capped at **3 URLs** per action. Stale layout revision is rejected with HTTP 409, absent consent with HTTP 403, and over-limit requests with HTTP 400.

### Connection and network protections

The scanner deliberately avoids a general-purpose server-side fetch:

1. Require HTTPS, a public DNS hostname, no embedded username/password, non-default port, query string or fragment. IPv4 literal/private aliases, IPv6 literals and invalid/local hosts are rejected. As a trade-off, signed URL images with query tokens are not eligible; verify those manually rather than send potentially secret-bearing URLs to the scanner.
2. Resolve all addresses first with a 2-second bounded DNS phase. **Reject the entire host if any result is non-public**, including link-local metadata, RFC 1918, reserved IPv4, IPv4-mapped IPv6 and non-global IPv6 prefixes.
3. Pass a **single validated IP to Node HTTPS connection's custom lookup function**, with TLS hostname/SNI and default certificate verification intact. This eliminates a second DNS lookup that could rebind to a private address between checking and connecting. Disable socket reuse for the probe.
4. Issue a single `GET` with a `Range: bytes=0-32767` header, a hard 4-second HTTPS deadline, a 32 KiB body limit and a fixed allowlist of PNG/JPEG/GIF/WebP MIME types. Redirects are **never followed**; HTML/JSON masquerading as images and image byte signatures mismatching declared content types do not pass.
5. The resulting report distinguishes resolver lookups from actual HTTPS connections, reports a sanitized reason/status/MIME/count and whether the observed bytes carry a recognizable image signature. No image bytes or provider secrets are included in API output. **ImageResponseObserved does not mean full file, CDN long-term availability, image copyright or platform rendering are verified.**

### Why this is not publication certification

Even successful partial image responses do not establish a complete uncorrupted file, future reachability, geographic/mobile CDN access, target platform support, author image rights, WeChat image proxy acceptance, browser display or publication. Reports intentionally keep `fullImageDownloaded:false`, `cdnReachabilityVerified:false`, `browserRenderVerified:false`, `platformVerified:false` and `published:false`. This observation is not used to automatically mark existing delivery-readiness stages as accepted.

The probe does not create a persistent approval record: running again is required to observe current network state, and any author QA record is still explicit/manual. Do not infer verification from the previous CDN simulation in V52, either.

### Verification

```bash
npm run test:images:v53
npm test
npm run test:images:v52
npm run build
npm run test:production
npm run test:e2e
# Real pinned doocs/md:2.1.0 Docker is needed for the separate suite:
npm run test:doocs:real
```

Synthetic tests inject DNS and HTTPS transport, **never call arbitrary real Internet hosts**, and cover denied/private/mixed DNS addresses, DNS resolution failures, refused insecure image URL forms, TLS connection pinning, redirects, timeouts, oversized streams, HTTP errors, incorrect MIME/bytes, explicit author consent, exact revision matching and request count. Chromium checks the consent gate, explicit action and resetting results on local mapping refresh.

## Release boundary

V49–V53 remain stacked Draft PRs. The GitHub connector cannot inspect all externally configured deployment triggers, so merging into main may cause an unknown deploy. Review production hooks and self-hosted env settings before proceeding. A **real public image network check** is opt-in and should be invoked only by the author on their own approved images. No real private data or paid model API was used in V53 CI.
