# Architecture Decision Records (ADRs)

One architectural or process decision = one file. Format: `ADR-NNN-kebab-case-title.md` using the template in [`../templates/adr.md`](../templates/adr.md). Never edit a merged ADR — to revise it, create a new one that supersedes it.

## Index

| ADR                                             | Title                                                            | Status   |
| ----------------------------------------------- | ---------------------------------------------------------------- | -------- |
| [ADR-001](./ADR-001-modular-monolith.md)        | Adopt Modular Monolith Topology                                  | Accepted |
| [ADR-002](./ADR-002-llm-extraction.md)          | Use LLM with Structured Extraction via Abstracted Port           | Accepted |
| [ADR-003](./ADR-003-fsm-postgresql.md)          | Persist Conversational FSM in PostgreSQL                         | Accepted |
| [ADR-004](./ADR-004-spreadsheet-adapter.md)     | Integrate Spreadsheets via Adapter Pattern                       | Accepted |
| [ADR-005](./ADR-005-bullmq-redis.md)            | Decouple Latency with BullMQ over Redis                          | Accepted |
| [ADR-006](./ADR-006-write-confirmation.md)      | Implement Write-with-Confirmation and Retry for Save Reliability | Accepted |
| [ADR-007](./ADR-007-oauth-aes256.md)            | Encrypt OAuth Tokens at Rest with AES-256                        | Accepted |
| [ADR-008](./ADR-008-user-identity.md)           | Use Local User Registration with Internal UUID                   | Accepted |
| [ADR-009](./ADR-009-fastify-persistent.md)      | Use Persistent Node.js Server with Fastify                       | Accepted |
| [ADR-010](./ADR-010-multi-environment-flyio.md) | Multi-Environment Deployment on Fly.io                           | Accepted |
| [ADR-011](./ADR-011-two-stage-pipeline.md)      | Two-Queue Pipeline for FIFO Message Ordering                     | Accepted |
| [ADR-012](./ADR-012-user-facing-text-copies.md) | Centralize User-Facing Text in Application Copy Modules          | Accepted |

## Template

For new ADRs, use [`docs/templates/adr.md`](../templates/adr.md).
