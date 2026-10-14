# Content Studio V51 — Real doocs/md Docker + Chromium handoff

V51 extends V50 from an **HTTP reachability check** to a **real, pinned third-party editor UI regression**, without falsely certifying a WeChat/Zhihu publication or performing paid AI work.

## Implementation

- CI starts `doocs/md:2.1.0`, hosted only at `127.0.0.1:8800` (container `80`).
- Separately, existing Playwright server management starts the actual Next.js production build and an isolated, temporary SQLite database at `127.0.0.1:4312`.
- `smoke/doocs-real-v51.spec.mjs` creates a unique synthetic article in Content Studio over the **real HTTP API**, loads the actual /compose UI, runs **复制 Markdown**, reads the browser clipboard, and checks the exact source Markdown matches the saved channel layout.
- It opens the **real doocs/md application** in a second browser page (not the V50 stubbed preflight), enters the copied Markdown into its real CodeMirror 6 `#editor .cm-content`, and checks that the real rendered `#output` preview contains both a unique marker and synthetic prose.
- It rechecks that Content Studio preserved the source Markdown and layout revision and did **not** mark the article `platformVerified` or `published`.
- Browser requests from the doocs page to domains outside loopback are **blocked**; no private prompts, API keys, raw images or actual user articles are used.

This verifies **real third-party editor input and render**, not perfect formatting, download fidelity, exported file import/review, clipboard paste in the external platform, imagery uploads, login, publication, or billed models. Do not label it as a complete end-to-end publishing test.

## How to run

After deploying the *local* Content Studio development or staging environment:

```bash
npm install
npm run build
docker run --rm -d --name content-studio-v51-doocs -p 127.0.0.1:8800:80 doocs/md:2.1.0
npm run test:doocs:real
docker rm -f content-studio-v51-doocs
```

The Playwright configuration uses a separate temporary SQLite database and a real `npm start`, so **do not point it at an existing user's database**. Normal `npm run test:e2e` does not depend on Docker. The CI job cleans up the container even on failure.

Check `playwright.doocs.config.mjs` and `smoke/doocs-real-v51.spec.mjs` if doocs/md changes its editor DOM in a new release. The Docker image is version-pinned intentionally; do not silently switch to `latest`.

## Risk & privacy boundaries

- Docker Hub is an external distribution provider and will be contacted to download the public image; this is not the same as uploading article content to a cloud editor. The screenshot/trace test artifact may contain **synthetic** article text, not user content.
- The current Next app is **single-user, localhost-only and unauthenticated**. Run container and Next bound to loopback; never make ports public for this test.
- The public doocs/md homepage and project documentation support Docker self-hosting and file import/export. The V51 CI tests CodeMirror entry and HTML preview, **not** full real export/import file parity. Full manual handoff remains an explicit requirement.
- V49 and V50 PRs are both Draft, and GitHub connector access cannot verify configured external deploy hooks/webhooks. V51 remains based on V50 and should not be merged out of order until those constraints are reviewed.
- Actual provider entitlement/billing, doocs/md export and reimport, real WeChat/Zhihu image behavior and desktop/mobile copy/paste are still unverified and must not be implicitly presented as passed.

## Release gate

```bash
npm run verify:integration
npm test
npm run test:interop
npm run build:preflight
npm run build
npm run test:production
npm run test:e2e
npm run test:doocs:real
```

The last command requires the **real local Docker image**. CI runs it after installing Chromium and completing normal E2E. A pass is a reproducible public-editor/browser compatibility check. It does not authorize publication or production deployment.
