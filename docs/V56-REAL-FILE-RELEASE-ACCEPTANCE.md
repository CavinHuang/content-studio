# V56 — Real SQLite files and backup freshness admission

V56 updates the **same consolidated Draft PR #26** with genuine local-file
rehearsal coverage and a stricter backup comparison. No public deployment,
merge, real user database access or paid/provider network calls were performed.

## Problem found

A WAL-consistent SQLite backup can have an internally valid manifest but be
**out of date**. In V55, backup and source *schema* matching alone could not
detect a newly created article or a rewritten existing article or image BLOB.
Even matching total row counts is not sufficient to distinguish in-place
content edits.

## Implemented

- The V45 SQLite reader now optionally executes an **actual read-only SQLite
  transaction** and calculates a deterministic SHA256 over every business
  table's ordered, type-sensitive row hashes, including BLOBs.
- V56's release admission opts into the content digest for the live source
  and the manifest-verified snapshot. It additionally carries row-count
  digests from each.
- The operator packet refuses acceptance if any of three independent checks
  disagree: `backup_schema_mismatch`,
  `backup_row_counts_mismatch`, or
  `backup_historical_content_mismatch`. It also retains manifest integrity,
  restored-copy data preservation and candidate SHA checks.
- The packet serializes only Boolean matches, status codes and reviewed Git
  SHA references. **It never serializes the underlying DB path, rows,
  image bytes, model tokens or content fingerprints.**
- A mismatch does not repair an old archive or mutate a live database; the
  operator must create a **new** protected backup, review current data and
  rerun the evidence command.

The additional full-row scan can be I/O-intensive on large local libraries;
run during a controlled maintenance period using trusted encrypted local
storage. The source is read-only in the scan. If the app is actively writing
during the backup or scans, a mismatch can be legitimate: pause writes,
take a fresh WAL-safe snapshot and rerun. Never bypass failures by setting
an "ignore" flag.

## True file-backed CI coverage (but synthetic records)

```bash
npm run test:release:real-files:v56
npm run test:release:v55
npm run integration:preflight
```

The V56 suite uses **real temporary files and real SQLite I/O**, not a mocked
`releaseAdmission` result:

1. Opens an actual `source.sqlite` in WAL mode and writes an editorial
   project, channel document revisions, a real PNG BLOB, a channel URL mapping
   and its history, plus a synthetic private sentinel in the briefs table.
2. Creates a WAL-consistent backup using the real Node SQLite backup API and
   validates its actual sidecar manifest and contents, including historical
   BLOB bytes.
3. Runs the exact V55 evidence collector with the real V46/V47 admission
   functions, real disposable restoration and channel integration rehearsal.
   The only mocked inputs are a synthetic *reviewed Git candidate* and
   synthetic *human deployment declaration*, since GitHub CI cannot know
   the operator's real hosting setup. Checks the original file/data are
   preserved and the resulting report does not contain the sentinel.
4. Creates a second article **after** an otherwise valid backup. The
   snapshot must be rejected because row counts have changed.
5. Updates a row in place **without altering table counts**. The old backup
   must be rejected by the content digest alone.
6. Forges a backup manifest checksum and verifies the packet does not pass.

CI additionally retains V45–V55 recovery, release and browser gates, the
real Next.js production restart and two real doocs Docker/browser scenarios.

## Real operator procedure is still outstanding

On your actual trusted run host, first inspect the real external hosting
deployment hooks and create a fresh backup with:

```bash
npm run db:backup -- --db=/private/app/content-studio.sqlite --out=/encrypted/snapshots/fresh.sqlite
npm run release:evidence:v55 -- \
  --db=/private/app/content-studio.sqlite \
  --backup=/encrypted/snapshots/fresh.sqlite \
  --review=/encrypted/reviews/v55.operator-review.json
```

**Use the candidate commit SHA from `git rev-parse HEAD` in the private
operator review file.** This exact candidate SHA changes whenever coding
adds a new commit, so a previous review cannot be reused silently.

The CLI may report `packetComplete: true` only on a structural local
evidence check; it always leaves `mergeAuthorized: false`,
`deployAuthorized: false`, `productionReady: false` and external hook
independent verification false. Full image-provider, actual external CDN,
WeChat/Zhihu and deployment acceptance are separate tasks.

The repo's historical integrated `main` remains at V48 while
PR #26 stays Draft. V49–V53 are not merged separately and alternative
PR #8 remains excluded.
