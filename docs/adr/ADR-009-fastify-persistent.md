# ADR-009: Use Persistent Node.js Server with Fastify

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

The initial project stack listed Next.js as the base framework without an ADR justifying that decision. Subsequent analysis revealed a structural contradiction: Next.js deployed on Vercel operates as ephemeral serverless functions with a maximum 60-second timeout, while the product requirements demand long-running processes that this model cannot satisfy.

The concrete requirements making the serverless model incompatible with Gastto are:

- BullMQ requires a persistent Node.js process with an active Redis connection. It cannot operate in ephemeral functions.
- The FSM's conversational timeouts (10 minutes in `EXPENSE_REVIEW`, 30 minutes in onboarding user stories) require a scheduler that survives between HTTP invocations.
- The expense queue from E1-US-13 processes messages in strict order with shared state between conversation turns.
- Epic 3 (Release 2) introduces periodic alerts and automatic summaries requiring scheduled jobs with second-level resolution, not minute-level.

The only real argument for serverless was Vercel's zero cost. This argument falls when evaluating that Fly.io offers a free tier with an always-active process, no cold starts, and configurable region, sufficient for the expected MVP volume.

Additionally, Next.js introduces frontend toolchain weight (React, client bundling, App Router, Server Components) that provides no value in a system without a web interface, and whose folder structure conventions conflict with the Clean Architecture defined in ADR-001.

## Considered Options

1. **Next.js on Vercel (serverless)**
   - Pros: Zero cost, automatic GitHub integration, preview deployments.
   - Cons: Incompatible with BullMQ, conversational timeouts, and periodic jobs. The ephemeral function model contradicts the product's long-running process requirements.

2. **Next.js on dedicated server (non-serverless)**
   - Pros: Eliminates the ephemeral function technical contradiction.
   - Cons: Maintains frontend toolchain weight with zero benefit. Next.js folder structure still conflicts with Clean Architecture.

3. **Express.js**
   - Pros: Viable technically, large ecosystem, familiar to many developers.
   - Cons: No native schema validation, worse TypeScript out-of-the-box support, lower performance in concurrent webhook benchmarks compared to Fastify.

4. **Next.js + separate worker service**
   - Pros: Separates HTTP and background processing.
   - Cons: Introduces exactly the multi-service infrastructure complexity that ADR-001 rejected. Two services to coordinate, two deploys, two failure points.

5. **Render (free tier)**
   - Pros: Simple deployment.
   - Cons: Suspends the process after 15 minutes of inactivity. A 30-second cold start is incompatible with the 300ms acknowledgment SLA defined in ADR-005.

6. **Fastify on Fly.io as persistent Node.js server**
   - Pros: Native schema validation, TypeScript support, high performance, persistent process, no frontend toolchain.
   - Cons: Loses Vercel's automatic GitHub integration, Fly.io free tier has VM limits.

## Decision

Gastto is a **persistent Node.js server** built with **Fastify** as the HTTP framework, deployed on **Fly.io** in its free tier for the MVP.

Next.js is removed from the stack. There is no frontend in the MVP and no Release 1 or Release 2 requirement justifies it.

The folder structure follows Clean Architecture from ADR-001 directly, without framework-imposed conventions:

```
src/
  domain/          # Entities, value objects, port interfaces
  application/     # Use cases, application services, FSM
  infrastructure/  # Adapters: DB, Redis, Telegram, WhatsApp, Sheets, LLM
  interfaces/      # HTTP handlers (Fastify routes), BullMQ workers
```

Fastify is chosen over Express for three concrete reasons: native schema validation with integrated JSON Schema (complements Zod in the application layer), superior performance in concurrent webhook throughput, and native TypeScript support without additional configuration.

Deployment on Fly.io uses a single process that launches both the HTTP server and BullMQ workers in the same runtime, maintaining the modular monolith topology from ADR-001.

## Rationale

- BullMQ operates in its native model: persistent process with active Redis connection, without workarounds or HTTP broker intermediaries. ADR-005 implements its decision without contradictions.
- Conversational FSM timeouts are implemented with delayed BullMQ jobs, viable in a persistent process.
- Clean Architecture folder structure is implemented without framework-imposed restrictions.
- No frontend toolchain: no React, no bundler, no client transpilation. The project compiles and starts faster.
- Fly.io keeps the process active without cold starts in the free tier, guaranteeing the 300ms acknowledgment SLA.
- Future migration to a dedicated server or own containers is trivial: the Dockerfile that Fly.io already requires is the deploy artifact.

## Consequences

### Positive

- BullMQ operates natively in persistent process without workarounds.
- FSM conversational timeouts implemented with delayed BullMQ jobs.
- Clean Architecture folder structure without framework restrictions.
- No frontend toolchain: faster compile and startup.
- Fly.io free tier maintains active process without cold starts.
- Future migration to dedicated server or containers is trivial.

### Negative

- Loses Vercel's automatic GitHub integration (preview deployments per PR). Mitigation: GitHub Actions with deploy to Fly.io on merge to main, which is standard one-hour configuration.
- Fly.io free tier has a limit of 3 shared VMs and 256 MB RAM per VM. Sufficient for expected MVP volume, but must be monitored as concurrent users grow.
- The team familiar with Next.js needs to learn Fastify. The curve is low since both are TypeScript HTTP frameworks, but it exists.
- Server maintenance responsibility (dependency updates, Fly.io configuration) falls on the team, unlike Vercel's managed model.

## References

- [`docs/adr/ADR-001-modular-monolith.md`](./ADR-001-modular-monolith.md)
- [`docs/adr/ADR-005-bullmq-redis.md`](./ADR-005-bullmq-redis.md)
- [`docs/architecture/system-overview.md`](../architecture/system-overview.md)
