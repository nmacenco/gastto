# Migrate Development Redis and Harden BullMQ Connections

## Goal

Eliminate the metered-command cost risk observed in the development Redis broker without sacrificing the persistent Fly.io runtime required by BullMQ, Telegram response latency, and scheduled jobs. Migrate `gastto-develop` from Upstash Redis to an isolated Aiven Valkey Free service, reduce unnecessary BullMQ polling, and ensure transient provider disconnects cannot terminate or silently disable Workers and Queues.

## Context

- The observed Upstash usage increased by about 800 commands in two minutes, approximately 400 commands per minute. If sustained, the current 500,000-command monthly free allowance would be exhausted in about 21 hours even with little user traffic.
- The command growth is primarily structural BullMQ activity, not business-message volume. The application starts up to four Workers and four Queues in one persistent Node.js process, and BullMQ accesses its broker while consumers are idle.
- Redis currently serves as the BullMQ broker and also stores idempotency markers, per-user processing locks, identity cache entries, mapping-correction state, and OAuth state. PostgreSQL remains the durable source of truth for users, conversational state, expenses, configuration, and encrypted OAuth tokens.
- Every Worker currently uses BullMQ's default `drainDelay` of 5 seconds. The application already increases `stalledInterval` to 120 seconds and the thick worker increases its lock timings, but these settings do not reduce empty-queue long-poll renewal as directly as `drainDelay`.
- The root ioredis client has an `error` listener in [`src/main.ts`](../../../src/main.ts), but the BullMQ Workers and Queues do not have equivalent `error` listeners. A connection reset emitted by one of those EventEmitters can become an unhandled exception or stop queue processing.
- [`src/bootstrap/buildDependencies.ts`](../../../src/bootstrap/buildDependencies.ts) creates the `incoming-message`, `process-message`, and `oauth-reminder` Queues.
- [`src/bootstrap/registerWorkers.ts`](../../../src/bootstrap/registerWorkers.ts) registers the Workers, creates the `session-timeout` Queue, and owns ordered shutdown of Workers before Queues.
- Worker factories and their current tests are located under [`src/interfaces/workers`](../../../src/interfaces/workers).
- [`ADR-005`](../../../docs/adr/ADR-005-bullmq-redis.md) selected BullMQ over Upstash Redis for the asynchronous pipeline. The BullMQ decision remains valid, but the metered provider assumption no longer matches the observed idle command profile.
- [`ADR-009`](../../../docs/adr/ADR-009-fastify-persistent.md) requires a persistent Fastify runtime to avoid cold starts and support BullMQ, conversational timeouts, FIFO processing, and future periodic jobs.
- [`ADR-020`](../../../docs/adr/ADR-020-persistent-fly-worker-lifecycle.md) requires one persistent Fly.io Machine per environment so delayed and pending jobs run independently of HTTP traffic. This plan preserves that accepted decision.
- [`fly.develop.toml`](../../../fly.develop.toml) and [`fly.toml`](../../../fly.toml) correctly keep their Machines active with `auto_stop_machines = 'off'` and `auto_start_machines = false`; neither file should change as part of this work.
- Aiven Valkey Free currently provides one single-node Valkey service per organization, 1 CPU, 1 GB RAM, backups, and no published per-command billing. Its default `maxmemory` is 50%, so the plan must treat approximately 512 MB rather than the full VM RAM as the usable keyspace ceiling. It has no SLA and Aiven may power off an unused free service. Development will use its own isolated service; production must not share that instance and remains unchanged until separately evaluated.
- Aiven Valkey Free does not allow choosing a cloud provider or region. The assigned location must therefore be discovered after provisioning and validated against the existing Telegram acknowledgment latency target before cutover; geographic proximity to Fly's `cdg` deployment cannot be assumed.
- Aiven Valkey is compatible with Redis OSS 7.2.4 and documents direct Node.js connectivity through ioredis. TLS is enabled by default, but Aiven displays TLS service URIs with the `valkeys://` scheme while the installed ioredis client enables TLS for `rediss://`. The operator workflow must provide an explicitly ioredis-compatible TLS configuration and prove TLS is active without logging connection details. Aiven also documents a default 300-second idle timeout and mandatory closure of older TLS connections after 12 hours, so reconnection behavior is an explicit acceptance criterion.
- Canonical behavior and constraints are documented in [`docs/adr/adr.md`](../../../docs/adr/adr.md), [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md), [`docs/architecture/config-env.md`](../../../docs/architecture/config-env.md), [`docs/architecture/error-taxonomy.md`](../../../docs/architecture/error-taxonomy.md), [`docs/features/deployment.md`](../../../docs/features/deployment.md), and [`docs/testing/guidelines.md`](../../../docs/testing/guidelines.md).
- Existing operational documentation still presents Upstash as the only deployed Redis provider and includes its former 10,000-command daily allowance. Current non-historical documentation must become provider-aware without modifying merged ADRs.
- No HTTP route, request or response payload, database schema, domain event, user-facing message, or Fly Machine lifecycle change is in scope.

### Public contracts

- `REDIS_URL` remains the only runtime connection contract. Development will receive an ioredis-compatible `rediss://` TLS URI, or the runtime configuration will explicitly and safely normalize Aiven's `valkeys://` scheme to equivalent TLS options before creating the client. Tests must prove TLS is enabled without printing the URI or credentials. Credentials remain exclusively in Fly secrets and must never be printed, committed, or copied into documentation.
- Development and production retain separate Redis-compatible services and credentials. The Aiven development service must never be shared with production, even through logical databases or key prefixes.
- Every BullMQ Worker factory will set `drainDelay: 30`, in seconds, while retaining its existing concurrency, retry, stall, and lock semantics.
- Comparable no-traffic measurements before and after the `drainDelay` change will use the same development runtime and a minimum ten-minute observation window. Phase 1 acceptance requires at least a 50% reduction in Redis command rate; if it is not achieved, the remaining command sources must be identified and the polling mitigation reconsidered before provider cutover.
- Every BullMQ Worker connection error will be consumed by an `error` listener and logged through injected Pino with the structured fields `msg`, `endpoint: 'bullmq'`, `code: 'BULLMQ_WORKER_ERROR'`, `queue`, and a sanitized `error` message. A low-level provider or socket code may be recorded separately as `causeCode`.
- Every BullMQ Queue connection error will be consumed by an `error` listener and logged through injected Pino with the structured fields `msg`, `endpoint: 'bullmq'`, `code: 'BULLMQ_QUEUE_ERROR'`, `queue`, and a sanitized `error` message. A low-level provider or socket code may be recorded separately as `causeCode`.
- The root ioredis error log will retain its listener and align with the repository's structured logging contract, including a stable endpoint and code. Error handlers must not log Redis URLs, credentials, stack traces, job payloads, or user identifiers.
- Error listeners handle recoverable resource events and allow ioredis/BullMQ reconnection behavior to continue. The implementation will not install a global `uncaughtException` or `unhandledRejection` handler that masks unrelated programming failures.
- Broker delivery remains at least once. Acceptance tests may prove an idempotent observable outcome for a controlled message, but neither the implementation nor documentation will claim exactly-once BullMQ processing.
- `fly.develop.toml` and `fly.toml` will retain `auto_stop_machines = 'off'` and `auto_start_machines = false`. Exactly one persistent `app` Machine per environment remains the operational contract from ADR-020.
- A new ADR will supersede only the Upstash-specific provider choice and obsolete cost assumptions in ADR-005. It will preserve BullMQ, the asynchronous pipeline, and ADR-020. No accepted ADR file will be edited.

## Phases

### Phase 1: Reduce active idle polling and make every Redis-backed resource failure-safe

#### Description

Deliver a testable BullMQ runtime that performs fewer empty-queue polls and converts Redis connection failures from unhandled EventEmitter errors into structured operational logs. Complete this protection before switching providers because Aiven intentionally recycles long-lived TLS connections and the runtime must reconnect safely.

#### To-do actions

- [ ] Introduce one shared BullMQ worker drain-delay value of 30 seconds and apply it to the `incoming-message`, `process-message`, `oauth-reminder`, and `session-timeout` Worker options without changing their current concurrency, retry, stall, or lock settings.
- [ ] Capture comparable minimum ten-minute no-traffic command-rate baselines immediately before and after the `drainDelay` change on the same Upstash-backed development runtime. Require at least a 50% reduction, record the observation without secrets or user data, and investigate remaining command sources before Phase 2 if the threshold is not met.
- [ ] Add a small typed helper for registering BullMQ `error` listeners with the approved structured log fields, usable by both Worker and Queue resources without exposing job data or connection details.
- [ ] Register Worker error listeners immediately after construction in all four Worker factories, keeping the existing `failed` job listeners separate because processor failure and infrastructure connection failure are different events. Serialize only the sanitized error message and optional low-level `causeCode`, never the `Error` object or its stack.
- [ ] Register Queue error listeners immediately after construction for the three dependency Queues in `buildDependencies` and the `session-timeout` Queue in `registerWorkers`, including when optional Telegram or Google OAuth feature bundles are absent.
- [ ] Align the root Redis client's existing error log in `main.ts` with the structured logging requirements while preserving ioredis automatic reconnection behavior.
- [ ] Extend `incomingMessage.worker.spec.ts`, `message.worker.spec.ts`, `oauthReminder.worker.spec.ts`, and `sessionTimeout.worker.spec.ts` to assert `drainDelay: 30` and verify that emitted Worker `error` events are logged once with the correct queue name and stable code.
- [ ] Extend `buildDependencies.spec.ts`, `registerWorkers.spec.ts`, and the bootstrap integration test as appropriate to assert that every Queue and the root Redis client register an `error` listener and produce redacted structured logs when that listener is invoked.
- [ ] Preserve and re-run the existing shutdown tests to prove Workers still close before Queues and listener registration does not change graceful shutdown ordering.
- [ ] Verify that one shared-client broker incident can produce one log per affected BullMQ resource plus the root client. Ensure each resource logs the event only once, document the expected fan-out, and prevent accidental duplicate listener registration or unbounded log amplification.
- [ ] Run the focused Vitest suites for bootstrap and all four Worker factories, then run `pnpm test`. Fix issues if any.
- [ ] Update [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md) with the active-runtime polling mitigation and the distinction between job processor failures and broker connection errors.
- [ ] Run `pnpm build` to verify the production bundle compiles. Fix issues if any.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Replace metered development Redis while preserving the persistent runtime

#### Description

Move only `gastto-develop` to an isolated Aiven Valkey Free service, validate all Redis and BullMQ behaviors against it, and preserve one continuously running Fly Machine. Record the provider decision in a new ADR rather than changing ADR-005 or ADR-020.

#### To-do actions

- [ ] Create one isolated Aiven Valkey Free service for development. Record the automatically assigned cloud and region without connection details, measure the resulting development latency, and require the existing Telegram acknowledgment target to remain satisfied before cutover. Do not place production data or production BullMQ keys in this free service.
- [ ] Keep TLS enabled and configure `REDIS_URL` as an ioredis-compatible `rediss://` URI, or implement the explicitly tested `valkeys://` normalization defined by the public contract. Prove that ioredis TLS options are active without exposing the service URI in terminal output, logs, screenshots, documentation, or version control.
- [ ] Record the Free service capacity guardrails: single node, no SLA, provider power-off rights, and approximately 512 MB usable keyspace under the default 50% `maxmemory` setting. Establish memory monitoring and an operational threshold before migration.
- [ ] Inventory development Redis responsibilities before cutover: BullMQ waiting, active, delayed, repeatable, completed, and failed jobs; processed-message markers; per-user locks; identity cache; mapping-correction state; and OAuth state.
- [ ] Verify before selecting it that Aiven's managed Redis-to-Valkey migration is available for the Free target and compatible with the Upstash source version, network exposure, TLS, ACLs, and replication or `SCAN` capabilities. Do not make successful managed migration a prerequisite until this feasibility gate passes.
- [ ] Select the cutover path based on the inventory and feasibility result. Prefer Aiven's managed migration when transient state or delayed jobs must survive; otherwise use an explicitly approved development maintenance window only after queues are drained and active conversational/OAuth flows are known to be disposable.
- [ ] Do not delete, flush, downgrade, or disconnect the Upstash source during cutover. Retain it unchanged through the rollback window.
- [ ] Update only the `REDIS_URL` Fly secret for `gastto-develop` through the authorized operator workflow. Do not read the existing secret value or store either provider URI in repository files.
- [ ] Keep [`fly.develop.toml`](../../../fly.develop.toml) unchanged with automatic stopping disabled, and add a regression check or explicit configuration assertion that both Fly environments retain their ADR-020 persistent lifecycle.
- [ ] Run a controlled development compatibility smoke test covering ioredis TLS connection and reconnect, BullMQ enqueue and consume for both pipeline queues, delayed and repeatable jobs, retries and backoff, stalled-job checks, Lua-based per-user lock acquire/release, TTL expiration, idempotency markers, identity cache, mapping state, and OAuth state cleanup.
- [ ] Test the five-minute idle-timeout scenario separately from connection recycling because active BullMQ blocking and stalled-check commands may prevent a connection from becoming idle. Verify the shared root connection and each Worker's dedicated blocking connection class independently.
- [ ] Cause at least one safe provider-initiated connection recycle or controlled equivalent. Require a `ready` or equivalent recovery signal, then enqueue and consume canary jobs for all four queues within a defined two-minute recovery window. Confirm the Node.js process remains alive, pending jobs resume, and logs contain only approved redacted metadata. Treat logging an error without demonstrated post-error processing as a failed acceptance criterion.
- [ ] Exercise a safe Telegram development message after cutover and verify acknowledgment latency, FIFO routing, an idempotent observable business outcome without duplicate side effects, final response delivery, and absence of Telegram retry loops. Document that BullMQ retains at-least-once delivery semantics.
- [ ] Verify OAuth reminders and session-timeout jobs execute while there is no inbound HTTP traffic, proving the persistent lifecycle continues to satisfy ADR-005, ADR-009, and ADR-020.
- [ ] Compare the pre-cutover Upstash command-rate evidence with Aiven runtime metrics. Record that command volume remains operationally useful for capacity monitoring but is no longer a metered free-tier exhaustion mechanism in development.
- [ ] Create `docs/adr/ADR-021-use-aiven-valkey-for-development-bullmq.md` from the ADR template. Document the observed Upstash cost failure, considered alternatives, isolated Aiven development selection, TLS and reconnection requirements, Aiven free-tier limitations, preservation of BullMQ and the persistent Fly runtime, production exclusion, rollback, and the exact portions of ADR-005 that it supersedes. Do not edit ADR-005, ADR-009, ADR-010, or ADR-020.
- [ ] Add ADR-021 to [`docs/adr/README.md`](../../../docs/adr/README.md) as Accepted after implementation and validation.
- [ ] Update [`docs/features/deployment.md`](../../../docs/features/deployment.md) to describe environment-isolated Redis providers, Aiven development provisioning and rotation without secret disclosure, persistent Machine verification, provider reconnect monitoring, cutover, and rollback.
- [ ] Update [`docs/features/README.md`](../../../docs/features/README.md) so the deployment index description reflects the provider-independent persistent lifecycle.
- [ ] Update [`docs/architecture/config-env.md`](../../../docs/architecture/config-env.md), [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md), [`docs/architecture/system-overview.md`](../../../docs/architecture/system-overview.md), and relevant local setup documentation so `REDIS_URL` describes a TLS Redis-compatible broker rather than assuming Upstash. Correct current non-historical free-tier information without editing accepted ADR history.
- [ ] Before cutover, define and approve the rollback window and recovery point objective. State explicitly that Upstash remaining unchanged preserves only pre-cutover state and does not receive jobs, locks, or transient state written to Aiven after cutover.
- [ ] Define rollback as pausing or draining development writes, inventorying Aiven-only pending and delayed jobs, explicitly accepting or transferring post-cutover transient state according to the approved recovery point objective, restoring the previous `gastto-develop` `REDIS_URL` secret, and redeploying or restarting the existing Machine through the normal operator workflow. Confirm no Machine scaling or Redis deletion is required.
- [ ] Run `pnpm test` after all code and documentation changes. Fix issues if any.
- [ ] Run `pnpm build` to verify the production bundle compiles. Fix issues if any.
- [ ] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [ ] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

Implement Phase 1 to establish the lower-polling, connection-safe BullMQ runtime before changing the development Redis provider.
