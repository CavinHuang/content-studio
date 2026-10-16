# V50 — doocs/md local service preflight and safe Next.js bundling

**Branch:** `feat/v50-doocs-live-preflight`, layered on V49 Draft PR #21. This is not a production deployment or proof that actual WeChat/Zhihu publishing works.

## 1. Local formatter availability in the composing UI

Content Studio deliberately uses **doocs/md as a separate formatter**, not as a direct React editor API. Previously, the compose page could open a configured URL but could not tell whether the service was actually running.

V50 adds `GET /api/integrations/doocs/preflight` and a status strip with a **重新检查连接** button in `/compose`. The check is limited to:

- Target from **server-controlled** `NEXT_PUBLIC_DOOCS_MD_URL`, or the default `http://127.0.0.1:8800/`.
- HTTP(S) on exact loopback hosts `localhost`, `127.0.0.1`, `[::1]`, port ≥ 1024 if specified, **root path only**; no credentials, query string or fragment.
- One unauthenticated, cookie-free `GET /` with a bounded timeout, `redirect:'manual'` (never follows external redirects) and no request body. No Markdown, user notes, images, AI prompts, model calls or publishing attempts leave the app.
- A response of HTTP 200 with `text/html` means **a local HTML service can be reached**. It does **not** establish that the response came from a real doocs/md instance, or that its Markdown export/copy, themes or WeChat image behavior is correct. If the host is missing, returns an error/JSON or redirects, report `unavailable` or `blocked` instead of pretending the editor is available.

Operator command:

```bash
docker compose -f docker-compose.doocs.yml up -d
npm run doocs:preflight
# Run the separate application on localhost
npm run build:preflight
npm run build
npm start
# Open http://127.0.0.1:4312/compose
```

When Next.js runs in a **different container/VM** than doocs/md, `127.0.0.1` refers to the **Next.js container's loopback**, not the host's. Configure networking explicitly on a trusted local-only interface; V50 intentionally does not probe remote or public URLs. Reachability failure does not disable manual Markdown export/import; the status is informational.

## 2. Prevent credentials being compiled into browser bundles

V49 checks local runtime configuration **before `npm start`**, but Next.js substitutes `NEXT_PUBLIC_*` variables at **build time**. An unsafe production build could already have baked secrets into browser JavaScript. V50 protects that earlier stage:

```bash
npm run build:preflight  # read-only local check, zero model calls
npm run build            # now runs scripts/build-guard.mjs build -> Next build
```

The guard loads Next.js environment files with `@next/env` before checking, rejects any populated `NEXT_PUBLIC_*` key whose **name** indicates a password, secret, private key, API key, token or credential, and exits nonzero. It does not print the secret values. It permits `NEXT_PUBLIC_DOOCS_MD_URL` because this is intentionally public metadata (address, not an API secret).

The guard does **not** detect arbitrary sensitive user data in otherwise innocently named public variables, and cannot remove values already compiled into an existing bundle. Operator must **rebuild** after correcting a bad configuration and verify that no old static assets with secrets are served. Backend-only `CONTENT_IMAGE_*_API_KEY` should never have the `NEXT_PUBLIC_` prefix.

This is an app-specific fail-closed check, not a replacement for Git secret scanning, runtime ACLs, authentication or tenancy controls.

## 3. Test coverage and evidence boundary

```bash
npm run test:interop
npm run build:preflight
npm run check
npm test
npm run build
npm run test:production
npm run test:e2e
```

Automated tests include:
- Real loopback HTTP server: verifies only one GET without article bytes/cookies/authorization is sent; a valid HTML response reports `reachable` but cannot claim actual doocs identity.
- Forged external URLs, credentials, unsafe paths, redirect to remote site, JSON response, disconnected endpoint: all blocked/unavailable safely with **zero article transmission**.
- `.env.local` with a synthetic `NEXT_PUBLIC_API_KEY`: must stop build preflight without printing its value; a clean configuration may invoke Next's real build.
- Chromium composer: displays unavailable status, then a mocked reachable preflight after clicking **重新检查连接**; never states the external platform was verified.

**Still manual:** actual doocs/md editor fidelity, export/import comparison, real WeChat and Zhihu paste/mobile rendering, third-party login, paid image model entitlements/billing and authentic user image rights are **not covered**. A fully green CI only validates local technical contracts. Never use real private articles in a cloud doocs instance without explicit consent.

## 4. Git integration

This V50 branch is based on V49 rather than main because V49 remains Draft. Verify both PR CI suites before merging; merge V49 into main first, then retarget/rebase V50 as appropriate. Do not merge V50 directly onto an older main through a misleading squash, and never treat platform verification as implied by code integration.
