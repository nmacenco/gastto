# ADR-001: Adopt Modular Monolith Topology

**Date**: 2025-04
**Status**: Accepted
**Deciders**: Architecture Team, Engineering Lead

## Context

Gastto's MVP requires coordinating multiple responsibilities: webhook reception, natural language processing, conversational state management, and writing to external spreadsheets. The decision on how to organize these components conditions development velocity, operational overhead, and future evolution capacity.

The team is small and the project has a bounded MVP horizon. A topology is needed that enables fast progress without mortgaging long-term architecture.

## Considered Options

1. **Microservices from day one**
   - Pros: Independent scaling, technology diversity per service, clear ownership boundaries.
   - Cons: Operational overhead (service mesh, per-service CI/CD, distributed observability) not justified for a small team in MVP phase.

2. **Monolith without modular separation**
   - Pros: Single deploy, minimal operational complexity.
   - Cons: Mixes responsibilities, creates immediate technical debt, and makes future service extraction difficult.

3. **Modular monolith**
   - Pros: Single repository and deploy, zero inter-service latency, clear internal boundaries that allow future extraction.
   - Cons: Requires team discipline to maintain module boundaries and avoid cross-coupling.

## Decision

Adopt a **modular monolith** as the starting topology, organized around five internal modules with clearly delimited responsibilities:

- **Messaging Gateway**: Receives webhooks from Telegram and WhatsApp Business API, validates origin (token/IP), and routes to the Orchestrator.
- **Flow Orchestrator (FSM)**: Determines where each user is in the conversational flow and delegates to the corresponding module.
- **NLP Engine (LLM)**: Calls the language model API to interpret expenses and generate natural language responses.
- **Spreadsheet Service**: Encapsulates all read/write logic over Google Sheets and Excel Online, including dynamic column mapping.
- **Conversational State Store**: Persists each user's conversation state in the database, not in volatile memory.

Module communication is asynchronous via message queue (see ADR-005).

## Rationale

- Development velocity: one repository, simple deploy, no inter-service latency.
- Clean Architecture in Node.js allows extracting modules to independent services in the future without structural refactoring.
- New epics (queries, reports) can be added without topology changes.

## Consequences

### Positive

- Fast development with a single repository and deploy.
- Clean Architecture enables future module extraction without structural refactoring.
- New epics can be added without topology changes.

### Negative

- Horizontal scalability is limited at the module level: if the NLP Engine becomes a bottleneck, scaling requires replicating the entire monolith.
- Requires team discipline to maintain module boundaries and prevent cross-coupling.

## References

- [`docs/architecture/module-contracts.md`](../architecture/module-contracts.md)
- [`docs/architecture/system-overview.md`](../architecture/system-overview.md)
