# ADR-021: Use Aiven Valkey for Development BullMQ

**Date**: 2026-08-23
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto runs BullMQ Workers continuously in the same persistent Fly.io process as
Fastify. Even with no user traffic, blocking queue polls and stalled-job checks
produce Redis commands. The development Upstash service enforced a metered daily
command allowance that the persistent runtime could exhaust while idle.

Phase 1 reduced the measured no-traffic command rate from 374.7 to 137.1 commands
per minute by setting every Worker to `drainDelay: 30`, while preserving queue
latency, retries, locks, and stalled-job behavior. This 63.41% reduction made the
runtime more efficient but did not remove the operational risk of a daily command
quota.

Development and production already use isolated Fly.io applications and secrets.
The Redis-compatible broker can therefore differ by environment without changing
BullMQ, application code, or the persistent Machine topology.

## Considered Options

1. **Keep the metered Upstash development service**
   - Pros: No provider cutover and an already validated TLS connection.
   - Cons: Idle Workers can still exhaust the daily command allowance after the
     polling reduction.

2. **Upgrade the Upstash development service**
   - Pros: Preserves the current provider and migration path.
   - Cons: Adds recurring cost solely to remove the development command quota.

3. **Self-host Valkey on Fly.io**
   - Pros: Full configuration control and no command metering.
   - Cons: Adds persistence, backup, patching, and recovery responsibilities to
     the application team.

4. **Use an isolated Aiven for Valkey Free service in development**
   - Pros: Managed TLS service without daily command metering, isolated from
     production, with metrics and logs in the Aiven Console.
   - Cons: Single node, no 99.99% SLA, provider power-off rights, no integrations,
     and a smaller usable keyspace than the advertised VM RAM.

## Decision

We chose **an isolated Aiven for Valkey Free service for `gastto-develop`**.

The development service is `gastto-develop-valkey`, currently running Valkey
9.1.1 on one DigitalOcean node in `ams`. Aiven assigns the provider and region for
Free services. Production is explicitly excluded from this decision and retains
its existing Redis provider and secret.

`REDIS_URL` is a provider-independent Redis-compatible broker contract. Hosted
environments use a TLS `rediss://` URI compatible with ioredis. Connection URLs,
usernames, passwords, hosts, and ports remain only in the environment's secret
manager and must never appear in logs, screenshots, documentation, or version
control.

The cutover preserved BullMQ and the ADR-020 topology: one continuously running
Fly `app` Machine, automatic stopping disabled, automatic starting disabled, and
a 30-second `SIGTERM` drain. No `fly.toml` file changed.

Aiven managed migration was rejected because its documented source gate requires
Redis 7.2 or lower while the Upstash source reported Redis 8.2.0. Development was
cut over during a maintenance window without copying data after a sanitized
inventory confirmed zero waiting, active, or failed business jobs and zero locks,
OAuth state, or mapping-correction state. Completed BullMQ history and
reconstructable caches were disposable; startup recreated the `session-timeout`
repeatable scheduler.

The previous Upstash URI remains recoverable and the source remains unchanged for
the approved 24-hour rollback window. The recovery point objective is zero data
loss for pending, active, or delayed business jobs. Aiven-only writes are not
replicated back to Upstash. Before rollback, operators must pause or drain writes,
inventory Aiven-only pending and delayed jobs, and explicitly transfer or accept
that state before restoring the previous Fly secret and restarting the existing
Machine.

The Aiven Free service exposes 1 GB VM RAM, but runtime validation measured
`maxmemory` at 313,524,224 bytes with `noeviction`. Operations monitor
`used_memory / maxmemory` and warn at 80%, or 250,819,379 bytes (approximately
239 MiB). A no-traffic ten-minute runtime baseline recorded 262.28 service-wide
commands per minute and approximately 6.3 MB used memory.

## Rationale

- Environment-isolated secrets allow development to change providers without
  expanding the production migration scope.
- BullMQ and ioredis compatibility was demonstrated over TLS, including delayed
  and repeatable jobs, retries and backoff, locks, TTL state, stalled checks, and
  connection recovery.
- A controlled connection recycle recovered all four logical queue roles in
  205 ms, and a separate 310-second idle test recovered the root connection and
  four blocking Worker connections within one second.
- A safe Telegram development canary completed the two-stage pipeline and
  cancellation without duplicate effects or Redis/BullMQ errors.
- The managed service removes daily command metering while retaining provider
  monitoring and backups appropriate for disposable development state.

## Consequences

### Positive

- Development command volume no longer consumes a metered daily allowance.
- Production data, secrets, and provider remain isolated and unchanged.
- BullMQ, ioredis, queue semantics, and the persistent Fly runtime remain intact.
- Development has provider metrics and logs for memory and connection monitoring.

### Negative

- The Free service has no high availability or 99.99% SLA and may be powered off
  after inactivity.
- Aiven may change the assigned provider, region, or configuration.
- Runtime `maxmemory` is materially lower than the VM's advertised 1 GB RAM.
- A provider outage can pause development queue processing until Aiven recovers or
  operators restore the previous Upstash secret.
- Development and production now require provider-specific operational knowledge.

This ADR supersedes only ADR-005's choice of Upstash as the development BullMQ and
cache provider, its Upstash-specific development command quota, and its associated
development alert threshold. ADR-005's asynchronous BullMQ architecture, retry
semantics, caching responsibilities, acknowledgment target, and production
history remain accepted. ADR-009, ADR-010, and ADR-020 remain unchanged.

## References

- [Aiven for Valkey Free tier](https://aiven.io/docs/products/valkey/concepts/valkey-free-tier)
- [Aiven Redis-to-Valkey migration limits](https://aiven.io/docs/products/valkey/howto/migrate-redis-aiven-cli)
- [Aiven for Valkey compatibility](https://aiven.io/docs/products/valkey)
- [`ADR-005`](./ADR-005-bullmq-redis.md)
- [`ADR-009`](./ADR-009-fastify-persistent.md)
- [`ADR-010`](./ADR-010-multi-environment-flyio.md)
- [`ADR-020`](./ADR-020-persistent-fly-worker-lifecycle.md)
- [`Deployment Operations Guide`](../features/deployment.md)
