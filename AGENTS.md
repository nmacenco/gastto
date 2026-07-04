# Useful commands

```bash
# Development
pnpm dev              # Start development server with hot reload (tsx watch)
pnpm build            # Build for production (tsup → dist/main.js)
pnpm start            # Run production build

# Testing
pnpm test             # Run tests once (vitest)
pnpm test:watch       # Run tests in watch mode
pnpm test:coverage    # Run tests with coverage report

# Linting & type checking
pnpm lint             # Lint source files (eslint)
pnpm lint:fix         # Lint and fix issues
pnpm format           # Format source files (prettier --write)
pnpm format:check     # Check formatting (prettier --check)
pnpm typecheck        # TypeScript type check without emit

# Database (Drizzle ORM)
pnpm db:generate      # Generate migration files
pnpm db:migrate       # Run pending migrations
pnpm db:studio        # Open Drizzle Studio
```

# Architecture

See `docs/adr/adr.md` for the full Architecture Decision Records (ADRs) covering the stack, patterns, and runtime choices.

## Key directories

```
src/
├── application/
│   ├── dtos/               - Data transfer objects
│   ├── services/           - Domain services
│   └── use-cases/          - Business use-cases (conversation, expense, spreadsheet, user)
├── config/                 - App configuration and env loading
├── domain/
│   ├── entities/           - Core domain entities
│   ├── ports/              - Repository/service interfaces (driven/driving)
│   └── value-objects/      - Immutable value objects
├── infrastructure/
│   ├── adapters/           - External service adapters (excel, llm, sheets, telegram, whatsapp)
│   ├── db/
│   │   ├── repositories/   - Drizzle repository implementations
│   │   └── schema/         - Drizzle table schemas
│   └── redis/              - Redis connection and helpers
└── interfaces/
    ├── http/routes/        - Fastify route definitions
    └── workers/            - BullMQ background job workers
```

# HTTP Routes & OpenAPI

- **Every new Fastify route must declare a Zod schema** in its `schema` option so that `@fastify/swagger` auto-generates OpenAPI documentation.
  - Use `app.withTypeProvider<ZodTypeProvider>().get/post/...`.
  - Include at minimum: `tags`, `description`, and `response` schemas.
  - See existing routes (`/health`, `/webhook/telegram`) as reference.
- Tests that instantiate Fastify independently must register `validatorCompiler` and `serializerCompiler` from `fastify-type-provider-zod`.
- Swagger UI is served at `/documentation` when the server is running.

# Documentation

- Detailed conventions with examples live in `docs/`.
- When working on a task, use this map to find and read only the docs relevant to your task:

```
docs/
├── adr/
│   ├── adr.md              - Architecture Decision Records index
│   └── template.md         - ADR template
├── architecture/
│   ├── config-env.md       - Environment variables, scripts, build config
│   └── data-model.md       - Data schemas and entities
├── changelog/              - Release changelogs
├── features/
│   └── <feature-name>.md   - One file per feature
├── plans/
│   └── plan-conventions.md - How to write plan documents
├── testing/
│   └── guidelines.md       - Testing rules, coverage targets, FSM checklist
├── typescript/             - TypeScript-specific conventions
│   ├── explicit-undefined-optional-properties.md - exactOptionalPropertyTypes handling
│   └── redundant-undefined-on-top-types.md - no `| undefined` on `unknown`/`any`
├── user-stories/           - Epics and user stories by release
└── documentation-guidelines.md
```

# Skills

- Skills are reusable agent instructions stored under `ai/skills/` (canonical source of truth). `.agents/skills/` contains symlinks for compatibility.
- Each skill has a `SKILL.md` with its full definition. Read it before invoking.
- When a user request matches a trigger phrase, invoke the corresponding skill.

| Skill         | Trigger                          | Path                                  |
| ------------- | -------------------------------- | ------------------------------------- |
| commit        | "commit changes", "/commit"      | .agents/skills/commit/SKILL.md        |
| create-doc    | "create doc", "/create-doc"      | .agents/skills/create-doc/SKILL.md    |
| create-plan   | "create a plan", "/create-plan"  | .agents/skills/create-plan/SKILL.md   |
| execute-plan  | "execute plan", "/execute-plan"  | .agents/skills/execute-plan/SKILL.md  |
| meta-prompt   | "/meta-prompt"                   | .agents/skills/meta-prompt/SKILL.md   |
| skill-creator | "create skill", "/skill-creator" | .agents/skills/skill-creator/SKILL.md |

<!-- Add new skills as they are created. Keep one line per skill. -->

# Plans

See `docs/plans/plan-conventions.md` for full plan conventions. Quick rules:

- When in plan mode and the user prompt starts with "Create a plan for" (in any language), read and follow `docs/plans/plan-conventions.md` to structure the plan output. Otherwise, plan normally without those conventions.
- **Plan-only prompts (no code changes):** Treat executing the plan as writing the plan document only under `ai/plans/`. Do not implement unless explicitly asked.
- **Implementing after a plan:** Only start coding when the user clearly requests implementation (e.g. "implementa el plan", "Implement the plan", "ejecuta el plan en código").

# Task Classification & Required Context

Classify the change before acting. Use the strictest category that applies.

## 1) Functional / Architecture / Data / Security / Documented Behavior Changes

Includes any change to:

- business logic or functional rules,
- architecture, modules, boundaries or system composition,
- security, auth, permissions, sanitization or secrets,
- data, DB, migrations, API contracts, validation or payloads,
- UX, interaction, accessibility, feedback, states, shortcuts,
- documented content contracts or behavior.

**Required docs before coding:**

- `docs/adr/adr.md` — locate relevant ADRs.
- `docs/features/<feature>.md` — understand rules, contracts, validations and tests.
- `docs/architecture/*.md` — when affecting architecture, security, data, modules or config.

## 2) UX / Behavior Changes

Even if business logic does not change, if interaction or visible behavior changes, treat it as a canonical change.

**Required docs before coding:**

- `docs/features/<feature>.md` if behavior is tied to a concrete feature.
- `docs/adr/adr.md` if needed for context.

## 3) Local Visual-Only / Refactoring Changes

Point-local changes that do not alter behavior, contracts, data, accessibility or UX rules.

**Default protocol:**

- Do not re-read `docs/features/*.md` or general docs by default.
- Re-use already-validated context in the thread if still applicable.
- Limit reading to directly affected files and their immediate dependencies.
- If during implementation functional or behavioral impact appears, re-classify the work and load the corresponding canonical docs.

# DB Conventions

- **Schema-first:** define tables in `src/infrastructure/db/schema/*.ts`. Generate migrations with `pnpm db:generate`. Never hand-write SQL under `drizzle/` unless for documented hotfixes.
- **Immutable migrations:** files in `drizzle/` are not edited or reordered once applied in any environment. To revert, create a **new** migration.
- **Destructive operations** (`DROP TABLE`, `DROP COLUMN`, `ALTER TABLE … DROP`, `TRUNCATE`, `ON DELETE` changes) require **explicit user confirmation** before generating. Propose a non-destructive alternative (rename + deprecate) when viable.
- **Foreign keys:** every FK declares `onDelete` explicitly (`cascade` / `set null` / `restrict`).
- **Indexes:** create explicit indexes on columns used in `WHERE`, `ORDER BY` or as FK. Document in `docs/architecture/data-model.md`.
- **Transactions:** use `db.transaction(...)` for multi-table mutations.
- **Seeds:** if seed scripts exist, keep them idempotent. Never touch production data.

# Documentation Sync

- Functional/API changes: update `docs/features/{feature}.md` when routes, payloads or rules change.
- DB changes: update `docs/architecture/data-model.md` when schema or relationships change.
- UX/interaction changes: update `docs/features/{feature}.md` and/or ADRs if behavior is affected.
- Decisions/trade-offs: new file in `docs/adr/YYYY-MM-DD-short-title.md` from `docs/adr/template.md`.
- No feature without canonical `docs/features/*.md`. Document implemented behavior only. Future work = explicit TODO with destination path.
- **When adding or updating any documentation under `docs/adr/` or `docs/features/`, always update the corresponding `README.md` index** (`docs/adr/README.md` or `docs/features/README.md`) so the directory index stays in sync.

# Done Gates

### Definition of Ready

- Problem/objective is explicit and testable. Scope is clear. Affected files identified. Risks visible.

### Ship Check

- `pnpm lint && pnpm typecheck && pnpm test` pass green.
- Functional changes: tests with meaningful assertions (Vitest).
- No filler tests. Mock only at boundaries (network, filesystem, DB), never core business logic.
- Drizzle migration applied locally and reflected in `docs/architecture/data-model.md`.
- Feature doc created or updated. No doc = blocked.

# Security & Secrets

## Agent File Access Restrictions

The following files and patterns contain sensitive secrets and must **never** be read by the agent:

- `.env` and `.env.*` (except `.env.example`)
- Any file containing passwords, API keys, tokens, or encryption keys
- `credentials.json`, `secrets.*`, `*.pem`, `*.key`

If the agent needs to know whether an environment variable is set or what a config field expects, it must:

1. Read `.env.example` for the schema/structure.
2. Ask the user to provide the specific value if needed.
3. Never attempt to read `.env` directly.

## Repository Protection

- `.env` and `.env.*` are already in `.gitignore` (line 69-71). Never commit them.
- If `DATABASE_URL` or other secrets are needed for commands (e.g., `pnpm db:migrate`), ask the user to run the command themselves or confirm the value before use.

# Observability & Rollback

- Server-side errors: `logger.error` with a structured object (`{ msg, endpoint, code, userId? }`). Use the Pino logger injected via constructor DI (`src/infrastructure/logger.ts`). Do not use `console.*`. Do not leak stack traces to the client.
- Destructive DB changes require a manual snapshot (`pg_dump` or equivalent) before applying.
- Rollback of release: revert the merge commit (`git revert -m 1 <sha>`). No force-push to `main`.
- Rollback of migration: **new** migration that reverts changes. Never edit/delete a merged migration.
