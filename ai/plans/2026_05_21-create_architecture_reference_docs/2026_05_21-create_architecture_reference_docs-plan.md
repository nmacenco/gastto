# 🎯 Goal

Create three new architecture reference documents under `docs/architecture/` — `fsm-states.md`, `async-pipeline.md`, and `error-taxonomy.md` — to provide actionable, implementation-level guidance for agents and developers, complementing the high-level decisions recorded in the ADRs.

## 👀 Context

- **Relevant ADRs:**
  - `docs/adr/adr.md` (ADR-003: FSM with 13 states, ADR-005: Async pipeline with BullMQ, ADR-006: Write-with-Confirmation + 3 error types)
- **Existing architecture docs:**
  - `docs/architecture/config-env.md`
  - `docs/architecture/data-model.md` (currently a placeholder)
  - `docs/architecture/module-contracts.md`
  - `docs/architecture/system-overview.md`
- **Key gap:** The ADRs justify decisions but are not structured for quick reference during coding. Agents implementing message handlers, workers, or error handling need concise rules, state tables, retry policies, and concrete error classifications in one place.

## 🪜 Phases

### Phase 1 — Document FSM States (`docs/architecture/fsm-states.md`)

**Description:** Produce a detailed operational reference for the 13-state FSM. This document will be the primary source for any agent writing conversation flow logic.

**To-do actions:**

- [x] Create `docs/architecture/fsm-states.md`.
- [x] Add a table of all 13 states with: state name, description, valid outgoing transitions, and timeout (if applicable).
- [x] Add a Mermaid text diagram showing the full transition graph.
- [x] Document `state_payload` JSONB fields per state (what fields are populated and their meaning).
- [x] Explain timeout implementation: BullMQ job with `delay`, explicitly not cron.
- [x] State the rule: never add conditional conversational flow logic outside the FSM.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

### Phase 2 — Document Async Pipeline (`docs/architecture/async-pipeline.md`)

**Description:** Produce a reference for the two-stage async pipeline. This document prevents agents from placing LLM calls inside Fastify HTTP handlers.

**To-do actions:**

- [x] Create `docs/architecture/async-pipeline.md`.
- [x] Add a Mermaid/text diagram of the two stages with target times (ack < 300ms, processing < 5s).
- [x] Define exactly what the Fastify handler does (validation, enqueue, immediate ack) and what it must NOT do (LLM calls, spreadsheet writes, heavy DB queries).
- [x] Define exactly what the BullMQ worker does (FSM recovery, LLM call, category mapping, spreadsheet write, state update, final user response).
- [x] List defined job types: `process-message`, `fsm-timeout`, and note future `scheduled-alert`.
- [x] Document concrete retry policy: 3 retries, exponential backoff 1s/2s/4s.
- [x] Document dead-letter handling: jobs exhausting retries go to `failed_jobs` table (or equivalent in `operation_logs`) for manual audit.
- [x] Document relevant Upstash free-tier limits for BullMQ (10,000 commands/day, 256 MB, alert threshold at 6,000 commands/day).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

---

### Phase 3 — Document Error Taxonomy (`docs/architecture/error-taxonomy.md`)

**Description:** Produce a reference mapping all error surfaces to concrete `error_type` values and system actions. This prevents agents from inventing inconsistent error strings or exposing technical details to users.

**To-do actions:**

- [x] Create `docs/architecture/error-taxonomy.md`.
- [x] List the three `error_type` values in `operation_logs`: `NETWORK_ERROR`, `AUTH_ERROR`, `STRUCTURE_ERROR`.
- [x] For each type: list concrete causes, system action, and exact user-facing message.
- [x] Document LLM-specific errors (timeout, unparseable response, invalid JSON) and their handling strategy.
- [x] Document channel errors (Telegram/WhatsApp 403, 5xx) and retry policy.
- [x] State the rule: users never see stack traces or technical messages.
- [x] State the rule: silent failures are prohibited — no confirmation means no save.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.


