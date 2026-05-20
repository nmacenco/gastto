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
├── testing/                - Testing conventions (to be added)
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
