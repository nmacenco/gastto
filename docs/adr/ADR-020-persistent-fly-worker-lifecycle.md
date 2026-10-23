# ADR-020: Keep Fly Worker Machines Persistent

**Date**: 2026-08-20
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto runs Fastify and its BullMQ workers in the same Node.js process. Delayed,
pending, and newly queued work therefore depends on an active Fly.io Machine with
a live Redis connection. The temporary lifecycle settings recorded in ADR-010
allowed Fly Proxy to stop every Machine while the service was idle, which became
unsafe once BullMQ workers were registered at runtime.

The service currently needs one Machine per environment. Additional high
availability would increase cost and may introduce queue-processing concurrency
that has not yet been justified by monitoring. Deployments, host migrations, and
manual Machine operations still need a bounded shutdown path so in-flight workers
can stop accepting work and release their BullMQ connections cleanly.

## Considered Options

1. **Keep automatic stopping with zero Machines allowed**
   - Pros: Lowest idle compute cost.
   - Cons: No worker consumes delayed or pending jobs while the app is stopped,
     and Fly Proxy traffic is not a reliable wake-up mechanism for Redis work.

2. **Keep one persistent Machine per environment**
   - Pros: Preserves HTTP availability and continuous BullMQ consumption with a
     simple, predictable runtime topology.
   - Cons: Incurs continuous compute cost and provides no redundancy during a
     Machine restart.

3. **Run multiple persistent Machines per environment**
   - Pros: Improves availability during host or Machine failure.
   - Cons: Increases cost and runtime concurrency before monitoring demonstrates
     that the additional capacity is necessary.

## Decision

We chose **one persistent Fly.io `app` Machine per environment**.

Both `fly.toml` files set `auto_stop_machines = "off"`, retain
`auto_start_machines = false`, and omit `min_machines_running`. The live Machine
count is managed explicitly with `flyctl scale count app=1`, and deployment uses
`flyctl deploy --ha=false` so recovery from zero Machines does not seed redundant
Machines.

Fly.io sends `SIGTERM` and allows a 30-second initial drain window. The executable
process handles `SIGTERM` and `SIGINT` idempotently by closing Fastify. Fastify's
shutdown lifecycle closes every registered BullMQ Worker before closing its
Queues. The 30-second timeout must be revisited if observed job duration shows
that normal drains cannot complete within the window.

This decision supersedes only the temporary `auto_stop_machines = true` and
`min_machines_running = 0` lifecycle subsection of ADR-010. Its multi-environment,
secret-isolation, branch-mapping, and resource decisions remain accepted.

## Rationale

- BullMQ requires an active consumer independent of inbound HTTP traffic.
- A single Machine matches current capacity needs and limits continuous cost.
- Explicit scale and `--ha=false` settings keep recovery behavior predictable.
- Signal-driven Fastify shutdown provides one ordered path for draining workers
  and releasing queues during legitimate Machine termination.
- A bounded timeout prevents deployments from hanging indefinitely.

## Consequences

### Positive

- Delayed and pending jobs continue to be consumed during HTTP-idle periods.
- Both environments use the same lifecycle and shutdown policy.
- Deployments and manual stops have a tested, ordered BullMQ cleanup path.
- Recovery from zero Machines preserves the single-Machine capacity policy.

### Negative

- Each environment incurs continuous Machine cost.
- A single Machine does not provide high availability during restarts or host
  failure.
- Jobs that exceed the 30-second drain window may still be interrupted and must
  rely on BullMQ retry and idempotency behavior.
- Operators must verify live Machine count because the config intentionally does
  not use `min_machines_running`.

## References

- [`ADR-005`](./ADR-005-bullmq-redis.md)
- [`ADR-009`](./ADR-009-fastify-persistent.md)
- [`ADR-010`](./ADR-010-multi-environment-flyio.md)
- [`Deployment Operations Guide`](../features/deployment.md)
- [`fly.toml`](../../fly.toml)
- [`fly.develop.toml`](../../fly.develop.toml)
