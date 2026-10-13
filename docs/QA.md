# QA — 2026-10-13

## Passed in this environment
- `npm run check`: Node syntax checks pass.
- `npm test`: legacy V27 logic and new API adapter contracts passed; see release summary for count.
- TypeScript parser (installed globally) parsed `components/StudioApp.jsx` and App Router JSX with 0 syntax diagnostics.

## Not run — environmental blocker
- Dependency installation (`npm view next` returned EAI_AGAIN DNS); no Next.js package or React package available in this runtime.
- Consequently Next build, hydration and live Next browser navigation were **not** tested. GitHub CI is configured to perform those checks on push.

## Browser acceptance to perform after `npm install`
1. Open `/` at 1440 / 1024 / 768 / 390 width; confirm no horizontal scrolling.
2. Open `/editor`, create and save main draft, refresh page and confirm data persists.
3. Change main draft, verify WeChat/Zhihu do not change automatically.
4. Unchecked export must fail; only after four channel confirmations should HTML export succeed.
5. Report an external URL; UI must say author-reported, not platform verified; changing draft must not mark new revision published.
6. Open `/discover`, sync sources, inspect original statements vs discussions, create new Brief and project; verify old project remains.
7. Test 409 stale revision error and recovery, malformed JSON, oversized payload, origin rejection.
8. Recheck target platform clipboard/paste layout with authorized accounts; do not treat localhost exports as successful platform publishing.
