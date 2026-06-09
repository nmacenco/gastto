# Reduce BullMQ Redis requests

## 🎯 Goal

Reduce BullMQ's internal Redis Lua script operations (~50k-70k requests/day from aggressive timer defaults) by tuning `stalledInterval`, `lockDuration`, `lockRenewTime`, and the session-timeout repeat interval, to stay within Upstash's 500k daily request limit.

## 👀 Context

- `src/main.ts:173-378` — All Queue/Worker wiring + session-timeout repeat job (line 362)
- `src/interfaces/workers/incomingMessage.worker.ts:37-46` — Worker opts for `incoming-message` (concurrency 1)
- `src/interfaces/workers/message.worker.ts:157-165` — Worker opts for `process-message` (concurrency 2, LLM)
- `src/interfaces/workers/oauthReminder.worker.ts:41-47` — Worker opts for `oauth-reminder` (concurrency 2)
- `src/interfaces/workers/sessionTimeout.worker.ts:23-29` — Worker opts for `session-timeout` (concurrency 1)
- `docs/adr/adr.md#adr-005` — Original BullMQ ADR
- `docs/architecture/async-pipeline.md` — Pipeline architecture doc
- `docs/plans/plan-conventions.md` — Plan structure conventions

## 🪜 Phases

### Phase 1 — Tune BullMQ polling defaults across all 4 workers + session-timeout repeat

Add `stalledInterval`, `lockDuration`, and `lockRenewTime` options to all 4 worker constructors, and increase the session-timeout repeat interval. All changes are additive config-only, no logic modified.

- [x] `src/interfaces/workers/message.worker.ts`: Add `stalledInterval: 120_000`, `lockDuration: 120_000`, `lockRenewTime: 60_000` (LLM jobs run 30-60s, need longer locks)
- [x] `src/interfaces/workers/incomingMessage.worker.ts`: Add `stalledInterval: 120_000`
- [x] `src/interfaces/workers/oauthReminder.worker.ts`: Add `stalledInterval: 120_000`
- [x] `src/interfaces/workers/sessionTimeout.worker.ts`: Add `stalledInterval: 120_000`
- [x] `src/main.ts:362`: Change `repeat: { every: 60000 }` → `repeat: { every: 120000 }`
- [x] Run `pnpm run lint && pnpm run typecheck && pnpm test` to verify no regressions
- [x] Ask the user if they want to review the changes before continuing

## ⏭️ Next step

Plan is single-phase; after Phase 1 completion, the task is done. Monitor Upstash Redis command count over the next 24h to verify reduction.
