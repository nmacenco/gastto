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

- [x] Introduce one shared BullMQ worker drain-delay value of 30 seconds and apply it to the `incoming-message`, `process-message`, `oauth-reminder`, and `session-timeout` Worker options without changing their current concurrency, retry, stall, or lock settings.
- [x] Capture comparable minimum ten-minute no-traffic command-rate baselines immediately before and after the `drainDelay` change on the same Upstash-backed development runtime. Require at least a 50% reduction, record the observation without secrets or user data, and investigate remaining command sources before Phase 2 if the threshold is not met.
- [x] Add a small typed helper for registering BullMQ `error` listeners with the approved structured log fields, usable by both Worker and Queue resources without exposing job data or connection details.
- [x] Register Worker error listeners immediately after construction in all four Worker factories, keeping the existing `failed` job listeners separate because processor failure and infrastructure connection failure are different events. Serialize only the sanitized error message and optional low-level `causeCode`, never the `Error` object or its stack.
- [x] Register Queue error listeners immediately after construction for the three dependency Queues in `buildDependencies` and the `session-timeout` Queue in `registerWorkers`, including when optional Telegram or Google OAuth feature bundles are absent.
- [x] Align the root Redis client's existing error log in `main.ts` with the structured logging requirements while preserving ioredis automatic reconnection behavior.
- [x] Extend `incomingMessage.worker.spec.ts`, `message.worker.spec.ts`, `oauthReminder.worker.spec.ts`, and `sessionTimeout.worker.spec.ts` to assert `drainDelay: 30` and verify that emitted Worker `error` events are logged once with the correct queue name and stable code.
- [x] Extend `buildDependencies.spec.ts`, `registerWorkers.spec.ts`, and the bootstrap integration test as appropriate to assert that every Queue and the root Redis client register an `error` listener and produce redacted structured logs when that listener is invoked.
- [x] Preserve and re-run the existing shutdown tests to prove Workers still close before Queues and listener registration does not change graceful shutdown ordering.
- [x] Verify that one shared-client broker incident can produce one log per affected BullMQ resource plus the root client. Ensure each resource logs the event only once, document the expected fan-out, and prevent accidental duplicate listener registration or unbounded log amplification.
- [x] Run the focused Vitest suites for bootstrap and all four Worker factories, then run `pnpm test`. Fix issues if any.
- [x] Update [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md) with the active-runtime polling mitigation and the distinction between job processor failures and broker connection errors.
- [x] Run `pnpm build` to verify the production bundle compiles. Fix issues if any.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

#### Command-rate evidence

- Measurement method: count Redis `MONITOR` events in memory from the running development Machine and emit only aggregate counts and UTC timestamps. Command arguments, keys, payloads, connection details, and credentials were neither printed nor stored.
- Pre-deploy baseline: Machine `48e3e79c943478`, version 49, Upstash-backed `gastto-develop`, 2026-08-22 11:18:15 UTC to 11:28:15 UTC. The ten-minute no-traffic window recorded 3,747 commands, or 374.7 commands per minute.
- Post-deploy measurement: the same Machine and provider, version 50, deployed from reviewed commit `8c6b46d`, 2026-08-22 11:30:53 UTC to 11:40:53 UTC. The ten-minute no-traffic window recorded 1,371 commands, or 137.1 commands per minute. This conservative window began shortly after deployment and therefore includes nearby startup activity.
- Result: `(3,747 - 1,371) / 3,747 = 63.41%` fewer commands. Phase 1 exceeds the required 50% reduction threshold and may proceed to Phase 2.

### Phase 2: Provision the target and approve a safe cutover

#### Description

Prepare the isolated Aiven development target and close the decision gates before changing `gastto-develop`. Inventory the current Upstash state, choose the migration path, and approve the maintenance cutover, rollback window, and recovery point objective. Validate the target's TLS, compatibility, latency, and capacity during the controlled real cutover in Phase 3.

#### To-do actions

- [x] Create one isolated Aiven Valkey Free service for development without placing production data or production BullMQ keys in it. The target is `gastto-develop-valkey`, running Valkey 9.1.1 on DigitalOcean in `ams`.
- [x] Inventory the current development Redis without exposing keys or values: BullMQ waiting, active, delayed, repeatable, completed, and failed jobs for all four queues; processed-message markers; per-user locks; identity cache; mapping-correction state; and OAuth state.
- [x] Verify whether Aiven's managed Redis-to-Valkey migration is available for this Free target and compatible with the Upstash source version, public TLS endpoint, authentication, and replication or `SCAN` capabilities.
- [x] Select an approved development maintenance cutover without copying data. Re-run the sanitized inventory immediately before changing `REDIS_URL`; abort if any pending, active, or failed business jobs, processing locks, OAuth state, or mapping-correction state exist. Completed BullMQ history and reconstructable caches may be discarded, and application startup recreates the `session-timeout` repeatable scheduler.
- [x] Approve a 24-hour rollback window and zero recovery point objective for pending, active, or delayed business jobs. Keep Upstash unchanged, but do not assume that it receives Aiven-only writes. Before rollback, pause or drain writes and inventory Aiven-only pending and delayed jobs; completed BullMQ history and reconstructable caches may be discarded.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

#### Pre-cutover evidence

- Target provisioned: `gastto-develop-valkey`, Valkey 9.1.1, Aiven Free, one DigitalOcean node in `ams`. Production remains excluded.
- Sanitized Upstash inventory captured on 2026-08-22 at 12:13 UTC from the running Fly `cdg` Machine. The source reports Redis 8.2.0 and 67 total keys. No key names or values were emitted.
- Queue state: `incoming-message` has 4 completed jobs; `process-message` has 2 completed jobs; `oauth-reminder` is empty; `session-timeout` has 40 completed jobs, one delayed scheduler occurrence, and one repeatable scheduler. All queues have zero waiting, active, failed, or paused jobs.
- Transient application state: zero processed-message markers, processing locks, identity-cache entries, mapping-correction states, and OAuth states.
- Sanitized Upstash inventory refreshed on 2026-08-22 at 14:09 UTC from the same Fly Machine. The source still reports Redis 8.2.0. It now has 126 total keys: `incoming-message` still has 4 completed jobs, `process-message` still has 2 completed jobs, `oauth-reminder` remains empty, and `session-timeout` has 99 completed jobs, one delayed scheduler occurrence, and one repeatable scheduler. Every queue still has zero waiting, active, failed, or paused jobs, and every transient application-state category remains at zero. No key names, values, user data, or credentials were emitted.
- Managed migration is not compatible with this source. Aiven's documented migration gate requires Redis 7.2 or lower, while Upstash reports Redis 8.2.0. The documented fallback from replication to `SCAN` does not remove that source-version gate.
- Approved path: a development maintenance cutover without data copy. Completed job history and reconstructable caches are disposable, and startup recreates the `session-timeout` repeatable scheduler. Re-run the sanitized inventory immediately before cutover and require the same zero waiting, active, failed, lock, OAuth, and mapping-state conditions.
- Approved rollback policy: keep Upstash unchanged for 24 hours, with zero data loss accepted for pending, active, or delayed business jobs. Aiven-only writes are not replicated back to Upstash. Before rollback, pause or drain writes and inventory Aiven-only pending and delayed jobs; completed history and reconstructable caches may be discarded.

### Phase 3: Cut over development and prove runtime recovery

#### Description

Move only `gastto-develop` to the approved Aiven target, preserve the persistent single-Machine topology, and demonstrate real compatibility and recovery across every Redis responsibility before accepting the new broker.

#### To-do actions

- [x] Do not delete, flush, downgrade, or disconnect the Upstash source during cutover. Retain it unchanged through the approved rollback window.
- [x] Confirm through the authorized operator that the previous Upstash URI remains securely recoverable for rollback without requesting, reading, or printing the URI or existing Fly secret value.
- [x] Re-run the sanitized Upstash inventory immediately before cutover. Abort if there are pending, active, or failed business jobs, processing locks, OAuth state, or mapping-correction state.
- [x] Update only the `REDIS_URL` Fly secret for `gastto-develop` through the authorized operator workflow. Do not read the previous secret value or store either provider URI in repository files.
- [x] During the controlled cutover, prove that the target keeps TLS enabled and that its private connection data works with ioredis as an equivalent `rediss://` URI without printing or storing the URI, username, password, host, or port in repository files, logs, screenshots, or conversation output.
- [x] During the controlled cutover, measure connectivity latency from the existing Fly `cdg` Machine to the assigned Aiven `ams` service and require the existing Telegram acknowledgment target to remain satisfied.
- [x] During the controlled cutover, verify the Aiven Free capacity guardrails: single node, 1 CPU, 1 GB RAM, no SLA, provider power-off rights, and actual `maxmemory`. Establish memory monitoring and an operational alert threshold before accepting the target.
- [x] Keep [`fly.develop.toml`](../../../fly.develop.toml) and [`fly.toml`](../../../fly.toml) unchanged with automatic stopping disabled, and add a regression check or explicit configuration assertion that both environments retain their ADR-020 persistent lifecycle.
- [x] Run a controlled development compatibility smoke test covering ioredis TLS connection and reconnect, BullMQ enqueue and consume for both pipeline queues, delayed and repeatable jobs, retries and backoff, stalled-job checks, Lua-based per-user lock acquire and release, TTL expiration, idempotency markers, identity cache, mapping state, and OAuth state cleanup.
- [x] Test the five-minute idle-timeout scenario separately from connection recycling because active BullMQ blocking and stalled-check commands may prevent a connection from becoming idle. Verify the shared root connection and each Worker's dedicated blocking connection class independently.
- [x] Cause at least one safe provider-initiated connection recycle or controlled equivalent. Require a `ready` or equivalent recovery signal, then enqueue and consume canary jobs for all four queues within a defined two-minute recovery window. Confirm the Node.js process remains alive, pending jobs resume, and logs contain only approved redacted metadata.
- [x] Exercise a safe Telegram development message after cutover and verify acknowledgment latency, FIFO routing, an idempotent observable business outcome without duplicate side effects, final response delivery, and absence of Telegram retry loops. Preserve BullMQ's at-least-once delivery semantics.
- [x] Verify OAuth reminders and session-timeout jobs execute while there is no inbound HTTP traffic, proving the persistent lifecycle continues to satisfy ADR-005, ADR-009, and ADR-020. The operator explicitly accepted isolated OAuth queue/state/reconnect evidence plus actual OAuth Worker readiness instead of mutating a linked account to trigger a real reminder.
- [x] Compare the pre-cutover Upstash command-rate evidence with Aiven runtime metrics. Record that command volume remains operationally useful for capacity monitoring but is no longer a metered free-tier exhaustion mechanism in development.
- [x] Define rollback execution as pausing or draining development writes, inventorying Aiven-only pending and delayed jobs, explicitly accepting or transferring post-cutover transient state according to the approved recovery point objective, restoring the previous `gastto-develop` `REDIS_URL` secret, and redeploying or restarting the existing Machine. Confirm no Machine scaling or Redis deletion is required.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

#### Cutover evidence

- Rollback gate approved by the authorized operator: the previous Upstash URI is securely saved and remains recoverable through the Upstash dashboard. Its value was not requested, read, or printed.
- Final sanitized Upstash inventory captured on 2026-08-22 at 14:27 UTC from Fly Machine `48e3e79c943478`, version 50, in `cdg`. The source reports Redis 8.2.0 and 135 total keys. `incoming-message` has 4 completed jobs; `process-message` has 2 completed jobs; `oauth-reminder` is empty; `session-timeout` has 108 completed jobs, one delayed scheduler occurrence, and one repeatable scheduler. All queues have zero waiting, active, failed, or paused jobs. Processed-message markers, processing locks, identity-cache entries, mapping-correction states, and OAuth states are all zero. No keys, values, user data, or credentials were emitted.
- Persistent-lifecycle assertion passed before cutover. Both Fly configuration files remain unchanged with `auto_stop_machines = 'off'`, `auto_start_machines = false`, `SIGTERM`, and a 30-second drain. The live development topology remains one running `app` Machine in `cdg`.
- The authorized operator replaced only the `gastto-develop` `REDIS_URL` secret through Fly.io. Machine `48e3e79c943478` restarted as version 51 at 2026-08-22 14:30 UTC in `cdg`; `/health` returned `ok`. Neither URI value was requested, read, printed, or stored in the repository.
- Target preflight passed from the Fly Machine. The URI uses `rediss://`, the live socket reports TLS, Aiven reports Valkey 9.1.1 with Redis 7.2.4 compatibility, and ten PING samples measured 12.92 ms minimum, 13.03 ms median, and 13.41 ms maximum. This remains compatible with the Telegram acknowledgment target, pending the end-to-end Telegram canary.
- Capacity evidence: Aiven Free remains one DigitalOcean node in `ams`, with 1 CPU, 1 GB RAM, no SLA, and provider power-off rights. Runtime `maxmemory` is 313,524,224 bytes with `noeviction`; observed usage was approximately 5.9 MB. Monitor `used_memory / maxmemory` in Aiven and warn at 80%, or 250,819,379 bytes (approximately 239 MiB).
- Isolated compatibility canaries passed without touching application queues or user data. Redis TLS, lock acquire and Lua release, TTL expiration, idempotency marker, identity cache, mapping state, and OAuth state round trips succeeded. All four logical queue roles consumed jobs; delayed and repeatable jobs, retry and backoff, stalled checks, root reconnect, and four dedicated blocking-connection reconnects succeeded. Post-recycle recovery took 205 ms, within the two-minute target.
- The separate 310-second idle test passed. A genuinely idle root connection recovered with a 14.9 ms PING, and four blocking Workers consumed post-idle canaries in 763 ms. The diagnostic load produced 1,984 aggregate commands, or 383.03 commands per minute, and ended at 6,287,192 used bytes of 313,524,224 bytes. This deliberately includes four extra Workers and is not the normal application baseline.
- Post-cutover application evidence: recent logs contained start signals for all four workers, zero Redis or BullMQ error codes, zero generic error lines, and zero Redis- or Valkey-URI patterns. With no inbound HTTP traffic, the real `session-timeout` queue completed seven jobs, retained one delayed occurrence and one repeatable scheduler, and recorded zero failures.
- Normal Aiven runtime baseline: a ten-minute no-traffic window with only the deployed application recorded 2,623 service-wide commands, or 262.28 commands per minute, and ended at 6,291,632 used bytes of 313,524,224 bytes. The previous Upstash evidence was 3,747 commands, or 374.7 per minute, before Phase 1 and 1,371 commands, or 137.1 per minute, after Phase 1. Aiven's `total_commands_processed` is service-wide and is not method-identical to the Upstash `MONITOR` count, so use 262.28 per minute as the new capacity baseline rather than as evidence of a BullMQ regression. Command volume remains useful for capacity monitoring but no longer exhausts a metered daily free-tier allowance in development.
- Telegram development canary passed. The operator sent a safe expense-like message, received the acknowledgment and exactly one expense summary in the same displayed minute, then cancelled it and received confirmation that nothing was saved. The screenshot showed no duplicate response or retry loop. Aggregate Redis evidence recorded three completed `incoming-message` jobs, two completed `process-message` jobs, two processed-message idempotency markers, zero waiting or active jobs, and zero failures. A post-canary scan found zero Redis or BullMQ error codes, generic error lines, retry-loop indicators, or Redis- or Valkey-URI patterns. BullMQ retains at-least-once delivery semantics; application idempotency prevents duplicate business processing for a retried external message identifier.
- OAuth acceptance scope: the actual `oauth-reminder` Worker started cleanly after cutover, and isolated canaries proved its queue role, delayed/repeatable scheduling, state TTL and cleanup, reconnect, and post-idle behavior without user data. A real reminder was not triggered because that would require mutating a linked account or a disposable onboarding identity. On 2026-08-23, the operator explicitly accepted this substitute evidence as sufficient for Phase 3.

### Phase 4: Record the provider decision and close validation

#### Description

Synchronize the implemented development-provider decision across canonical documentation, preserve historical ADRs, and run the complete project quality gates.

#### To-do actions

- [x] Create `docs/adr/ADR-021-use-aiven-valkey-for-development-bullmq.md` from the ADR template. Document the observed Upstash cost failure, considered alternatives, isolated Aiven development selection, TLS and reconnection requirements, Aiven Free limitations, preservation of BullMQ and the persistent Fly runtime, production exclusion, rollback, and the exact portions of ADR-005 that it supersedes. Do not edit ADR-005, ADR-009, ADR-010, or ADR-020.
- [x] Add ADR-021 to [`docs/adr/README.md`](../../../docs/adr/README.md) as Accepted after implementation and validation.
- [x] Update [`docs/features/deployment.md`](../../../docs/features/deployment.md) to describe environment-isolated Redis providers, Aiven development provisioning and rotation without secret disclosure, persistent Machine verification, provider reconnect monitoring, cutover, and rollback.
- [x] Update [`docs/features/README.md`](../../../docs/features/README.md) so the deployment index description reflects the provider-independent persistent lifecycle.
- [x] Update [`docs/architecture/config-env.md`](../../../docs/architecture/config-env.md), [`docs/architecture/async-pipeline.md`](../../../docs/architecture/async-pipeline.md), [`docs/architecture/system-overview.md`](../../../docs/architecture/system-overview.md), and relevant local setup documentation so `REDIS_URL` describes a TLS Redis-compatible broker rather than assuming Upstash. Correct current non-historical free-tier information without editing accepted ADR history.
- [x] Run `pnpm test` after all code and documentation changes. Fix issues if any.
- [x] Run `pnpm build` to verify the production bundle compiles. Fix issues if any.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases are complete; review and commit the finished implementation and operational documentation.
