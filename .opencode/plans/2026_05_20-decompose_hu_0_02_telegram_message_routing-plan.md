# Plan: Decompose HU-0.02 — Receive, Parse and Route Incoming Telegram Messages

## Goal

Decompose user story HU-0.02 into atomic, implementation-ready tasks following the project's Clean Architecture, conventions, and sub-task template. Produce the translated user story, task files, dependency tree, and estimation summary.

## Context

- **Source user story:** `docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.02 — Recibir, parsear y rutear mensajes entrantes.md`
- **Project conventions:** `AGENTS.md` defines the stack (TypeScript, Fastify, Drizzle, BullMQ, Vitest) and Clean Architecture layers.
- **Task template:** `docs/templates/sub-tasks.md` mandates the exact format for each task file.
- **Plan conventions:** `docs/plans/plan-conventions.md` guides phase organization.
- **User story summary:** The system must receive Telegram webhooks, parse the payload (extract chat_id, user_id, text, timestamp), route messages by type (text / unsupported / malformed), handle unsupported types gracefully, and guarantee ordered processing. Story Points: 3.

## Phases

### Phase 1: Validate input, translate user story, and create folder structure

**Description:** Verify the source file exists and matches the naming convention (`HU-N.M — <title>.md`), translate the entire user story to English, generate the folder slug, create the target folder, persist the translated file, and delete the original.

**To-do actions:**

- [x] Verify the source file exists at the provided absolute path.
- [x] Extract HU ID (`HU-0.02`) from the filename and validate the pattern.
- [x] Translate the user story title, narrative, Gherkin scenarios, definition of done, and story points to English.
- [x] Generate the English slug: `receive-parse-and-route-incoming-messages`.
- [x] Check if target folder `HU-0.02-receive-parse-and-route-incoming-messages` already exists; if so, ask the user before proceeding.
- [x] Create the target folder and `tasks/` subfolder.
- [x] Write the translated user story inside the new folder, preserving the original filename pattern but with the English title.
- [x] Delete the original user story file.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 2: Decompose into atomic tasks

**Description:** Analyze the translated user story and break it down into atomic, ordered, unambiguous implementation tasks. Each task must map to one Clean Architecture layer, include acceptance criteria, dependencies, and effort estimation. Ensure bootstrap and Clean Architecture boundary guardrails are applied.

**To-do actions:**

- [x] Define task `T-0.02-01`: Define domain message types and value objects (e.g., `IncomingMessage`, `MessageType`).
- [x] Define task `T-0.02-02`: Implement Telegram payload parser (extract chat_id, user_id, text, timestamp) with validation.
- [x] Define task `T-0.02-03`: Implement message router / dispatcher by type (text, unsupported, malformed).
- [x] Define task `T-0.02-04`: Implement unsupported message handler with friendly user response.
- [x] Define task `T-0.02-05`: Implement malformed payload handler (log full payload, respond 200 to Telegram, no exception propagation).
- [x] Define task `T-0.02-06`: Implement ordered processing guarantee (BullMQ queue or synchronous handler) for rapid successive messages.
- [x] Define task `T-0.02-07`: Write unit tests covering all four Gherkin scenarios.
- [x] Assign architectural layers, acceptance criteria, technical/delivery dependencies, and hour estimates to each task.
- [x] Ensure total hours are coherent with 3 Story Points (target: 6-12 hours).
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

### Phase 3: Generate task files, dependency tree, and estimation summary

**Description:** Persist each task as an individual `.md` file inside the `tasks/` folder, create the dependency tree diagram, and generate the estimation summary.

**To-do actions:**

- [x] Create `tasks/T-0.02-01.md` through `tasks/T-0.02-07.md`, strictly following `docs/templates/sub-tasks.md` format.
- [x] Create `tasks/dependency-tree.md` with a Mermaid graph or tree showing task relationships and identifying the critical path.
- [x] Create `tasks/estimation-summary.md` with total hours, per-task breakdown, and coherence check against Story Points.
- [x] Verify all task IDs follow the `T-0.02-NN` pattern and all cross-references are consistent.
- [x] Run `pnpm run lint` and `pnpm run typecheck` to verify linting and typechecking. Fix issues if any.
- [x] Ask the user if they want to review the changes before continuing, or proceed directly with the next phase.

## Next step

All phases completed. Plan is closed.
