# Content Studio V39 — Durable Illustration Queue

**Status:** implemented on stacked branch `feat/v39-durable-illustration-queue`, based on V38, not merged to main. Trusted **single-process, single-user, localhost** deployment only.

## User experience

Visit `/illustrations/queue` from `/illustrations`.

1. Select one or more articles (the UI lists up to the latest 30), then select only their **current** `planned` / `failed` image slots. Each selected item is tied to the exact plan, article revision and slot timestamp.
2. Choose a primary image provider; optional fallback providers may add up to two more charged attempts. Check the external model authorization box.
3. **加入任务队列:** this writes only SQLite metadata. **No provider call happens.** Replaying the same idempotency key and same batch yields the same job identifiers.
4. **开始／恢复执行:** explicit second consent starts one at a time in first-in-first-out order. The queue uses the same V38 per-article daily UTC budget; a 429 budget error blocks that job and stops the worker.
5. Inspect states, refresh source plans and review the jobs. **暂停后续任务** stops subsequent jobs after the current one finishes. **取消排队** is immediate; cancelling a running job is a best-effort request only. Already-dispatched providers may bill and may return a generated **unapproved** image. A cancel request stops further fallback attempts, not an in-flight provider network call.
6. Failed / budget-blocked jobs can be put back in the queue only by an author with renewed external permission. This does not automatically start them.
7. When the local process restarts, persisted `running` jobs become `interrupted`. **Never auto-repeat any prior paid request.** The image slot may remain in `generating`. After 5 minutes, the author may use V38 manual recovery, verify upstream billing, and create a new batch with a new key. Old interrupted jobs stay in audit history.
8. Generation results always remain `generated`, never `approved`: image-to-channel mapping, doocs/md handoff and publication still need separate author review.

## Durable state schema

- `illustration_queue_batches`: batch ID, globally unique client idempotency key, SHA256 of canonical item list and provider options, creation time. No prompt or file bytes.
- `illustration_queue_jobs`: job ID, batch ID, project/shot/plan IDs, source revision, expected slot timestamp, provider choices, attempts limit, status, cancellation intent and timestamps. Unique partial index on (`project_id`, `shot_id`) while `queued` or `running`.
- `illustration_queue_events`: append-only status transition events (queued, started, completed, cancelled, interrupted, requeued, budget-blocked, stale/obsolete).
- Existing `article_illustration_attempts` and `image_request_ledger` remain sources of truth for individual provider attempts and conservative request reservations. **The queue does not represent actual provider invoice amounts.**

Status lifecycle:

```text
queued ──start──> running ──success──> completed (image still unapproved)
  │                │  │
  └──cancelled     │  ├─error─────────> failed ──author retry──> queued
                   │  ├─budget────────> blocked_budget ──author retry──> queued
                   │  ├─cancel request> cancelled (provider may already have billed)
                   │  └─process crash─> interrupted (no automatic replay)
                   └─stale plan/source> obsolete (replan required)
```

A `pause` leaves queued jobs queued, while the current job may finish. The queue does not own or alter image approval, external publishing, channel layout, or knowledge evidence.

## Local APIs

| Method | Endpoint | Contract |
|---|---|---|
| POST | `/api/illustrations/queue/batches` | `{idempotencyKey,allowExternalAI:true,items:[{projectId,shotId,expectedUpdatedAt}],provider,fallbackProviders,maxAttempts}` — transactional enqueue (1–30 items) |
| GET | `/api/illustrations/queue?projectId=` | Queue statuses, counts, latest 80 jobs, author-consent flags |
| POST | `/api/illustrations/queue/start` | `{allowExternalAI:true}` — explicit dispatch or resume |
| POST | `/api/illustrations/queue/pause` | Stop after the running job, no provider abort claim |
| POST | `/api/illustrations/queue/jobs/:jobId/cancel` | Cancel pending job or request no further attempts |
| POST | `/api/illustrations/queue/jobs/:jobId/retry` | `{allowExternalAI:true}`; only failed/budget-blocked jobs with still valid source/plan |
| GET | `/api/illustrations/queue/jobs/:jobId/events` | Latest 30 audit transitions |

The queue uses `illustrations.generate()`, which continues to enforce source freshness, model configuration, explicit consent, local asset validation and per-attempt daily budgets. Existing localhost/Origin protections in `lib/api.mjs` apply.

## Acceptance and operator notes

Run `npm test && npm run check && npm run build`. V39 tests include idempotency, no provider calls before consent/start, cross-article FIFO, pause, cancel of queued/running jobs, stopping fallback, obsolete plan before dispatch, UTC budget blocking/retry, SQLite process restart and explicit crash recovery.

Use **only a single writable server process** for this local SQLite worker. Worker ownership is in-memory; the DB queue coordinates within that process, not across a cluster or Edge/serverless instances. Never set `CONTENT_STUDIO_ALLOW_REMOTE=1` for an untrusted network. There is no multiuser identity, CSRF security guarantee, worker lease/heartbeat protocol, provider exactly-once guarantee, automatic billing reconciliation or guaranteed remote API abort. Those would need separate production infrastructure.

The CI Node suites use injected test providers. A passing build does **not** prove paid OpenAI/Nano Banana/Qwen calls or WeChat/Zhihu image output. Live providers require explicitly authorized keys and a separate metered acceptance test.
