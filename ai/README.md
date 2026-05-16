# Gastto — AI Workspace

This directory contains agent-specific resources, hooks, and documentation for the Gastto conversational financial assistant.

## Structure

```
ai/
├── agents/              # Agent-specific configurations (currently empty)
├── hooks/               # Post-edit automation scripts
│   ├── post-edit-format.mjs
│   ├── post-edit-lint.mjs
│   └── post-edit-typecheck.mjs
├── llm/
│   └── PROJECT_CONTEXT.md  # Compact project summary for AI agents
├── plans/               # Generated implementation plans (see docs/plans/ for conventions)
└── skills/              # Reusable agent skills (canonical source of truth)
    ├── commit/
    ├── create-doc/
    ├── create-plan/
    ├── execute-plan/
    ├── meta-prompt/
    └── skill-creator/
```

## Skills

Skills are reusable agent instructions. Each skill has a `SKILL.md` with its full definition.

| Skill           | Description                               |
| --------------- | ----------------------------------------- |
| `commit`        | Version control workflows and PR creation |
| `create-doc`    | Documentation creation                    |
| `create-plan`   | Implementation planning                   |
| `execute-plan`  | Plan execution                            |
| `meta-prompt`   | Prompt improvement                        |
| `skill-creator` | Create or modify agent skills             |

> **Note:** This directory contains the canonical skill definitions. `.agents/skills/` contains symlinks for compatibility.

## Hooks

Post-edit hooks run automatically after file modifications to maintain code quality:

- **`post-edit-format.mjs`** — Runs Prettier on modified files
- **`post-edit-lint.mjs`** — Runs ESLint on modified files
- **`post-edit-typecheck.mjs`** — Runs TypeScript type checking

## LLM Context

See [`llm/PROJECT_CONTEXT.md`](./llm/PROJECT_CONTEXT.md) for a compact summary of the project stack, architecture, and conventions optimized for AI agent consumption.

## Plans

Generated implementation plans are saved here following the conventions in `docs/plans/plan-conventions.md`.

---

_For project-level documentation, see the `docs/` directory at the repository root._
