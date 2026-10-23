---
name: us-task-generator
description: Decompose a User Story markdown file into atomic implementation tasks. Use this skill whenever the user wants to generate tasks from a user story, break down a US into sub-tasks, create implementation tasks from a HU file, or turn a user story file into actionable development tasks. Also trigger when the user provides a path to a HU/User Story .md file and asks to decompose, plan, or generate tasks for it. This skill translates the user story to English, creates a properly named folder, and generates one task file per atomic sub-task following the project's sub-task template.
---

# User Story Task Generator

Decompose a User Story (HU) markdown file into atomic, implementation-ready tasks.

## Goal

Given an absolute path to a User Story `.md` file, produce:

1. A folder named `<story-ID>-<english-slug>` in the same directory as the original file.
2. An English-translated version of the User Story inside that folder.
3. A `tasks/` subfolder containing one `.md` file per atomic implementation task.
4. A dependency tree file mapping task relationships.
5. A total effort estimation coherent with the User Story's Story Points.

The original User Story file is deleted after the translated version is created inside the new folder.

## Arguments

`$ARGUMENTS` must contain the **absolute path** to the User Story markdown file.

Example:

```
/home/nicolasmacenco/NICO/gastto/docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/HU-0.01 — Registrar el bot en Telegram y configurar el webhook.md
```

## Process

### 1. Validate input

- Check the file exists.
- Verify it is a `.md` file.
- Extract the story ID from the filename. Accept either of these patterns:
  - `HU-N.M — <title>.md` or `HU-N.M - <title>.md` (legacy format).
  - `E<epic>-US-<story> — <title>.md` or `E<epic>-US-<story> - <title>.md` (project format, for example `E1-US-09`).
- Preserve the detected story ID exactly as written. Do not force the `HU-` prefix or convert one supported format into the other.
- If the filename does not match either supported pattern, warn the user with the accepted formats and stop.

### 2. Read project context

- Read the root `AGENTS.md` to understand the project's tech stack, architecture, and conventions.
- Read `docs/templates/sub-tasks.md` to determine the exact format each task file must follow.
- Read the User Story file content.

### 3. Translate the User Story

- Translate the entire User Story content to English, preserving all Markdown formatting.
- Translate the title to English. This title is used to build the folder slug.
- Keep the story ID (e.g., `HU-0.01` or `E1-US-09`) unchanged.

### 4. Generate the folder name

- Format: `<story-ID>-<english-slug>`
- The `english-slug` is derived from the translated title: lowercase, special characters and spaces replaced with hyphens, consecutive hyphens collapsed, no trailing hyphen.
- Examples:
  - `HU-0.01 — Registrar el bot en Telegram y configurar el webhook` → `HU-0.01-register-telegram-bot-and-configure-webhook`
  - `HU-1.02 — Crear entidad de Gasto` → `HU-1.02-create-expense-entity`
  - `E1-US-09 — Cancelación del registro sin consecuencias` → `E1-US-09-cancel-registration-without-consequences`

### 5. Create folder and persist translated User Story

- The new folder is created in the **same directory** as the original file.
- **Before creating**, check if the folder already exists.
  - If it exists, **ask the user** whether to overwrite, merge, or abort. Do not proceed without explicit confirmation.
- Write the translated User Story inside the folder using the same filename as the original.
- Delete the original User Story file.

### 6. Decompose into atomic tasks

Analyze the User Story content (Gherkin scenarios, acceptance criteria, definition of done, story points) and decompose it into **atomic, ordered, unambiguous** implementation tasks.

Each task must:

- Have a unique ID: `T-<story-ID>-<zero-padded-sequence>`.
  - For the legacy `HU-N.M` format, omit the `HU-` prefix in task IDs: `HU-0.01` becomes `T-0.01-01`.
  - For the project `E<epic>-US-<story>` format, preserve the complete ID: `E1-US-09` becomes `T-E1-US-09-01`.
- Be assigned to exactly one Clean Architecture layer: `Domain`, `Application`, `Infrastructure`, `Interfaces`, or `Cross-cutting`.
- Include a clear technical description of what to implement.
- List verifiable acceptance criteria.
- List explicit dependencies on previous tasks (or `None`).
- Include an effort estimation in hours.
- Be small enough for a single developer to complete without ambiguity.

**Task ordering:** Tasks must be ordered by dependency. A task that requires another to be finished first must have a higher sequence number and list that dependency.

**Effort estimation:** The sum of all task hours should be coherent with the User Story's Story Points. As a rough guide:

- 1 SP ≈ 2–4 hours
- 2 SP ≈ 4–8 hours
- 3 SP ≈ 6–12 hours
- 5 SP ≈ 10–20 hours
- 8 SP ≈ 16–32 hours

Distribute hours across tasks based on complexity. The estimation should reflect the actual work considering the project's stack (from `AGENTS.md`).

**Bootstrap guardrail:** If this User Story is among the first of the project and the runtime scaffold (server, config, logging, error tracking, base folder structure) does not yet exist, **explicitly add a bootstrap task** (e.g., `T-0.01-00`) rather than absorbing that work into feature tasks. This prevents hidden underestimation and keeps feature tasks focused. It is acceptable for the first HU to exceed the nominal SP range because it carries foundational scaffolding that later HUs will reuse.

**Clean Architecture boundary guardrail:** Whenever a task involves business logic that originates from an external trigger (e.g., a Telegram `/start` command), the task description and technical notes must explicitly state that:

- The route handler (Interfaces layer) **only** deserializes, validates, and delegates.
- The use case (Application layer) contains **all** business logic.
- An output port (Application layer) keeps the use case agnostic of the external service.
- This boundary must be established from the first task that touches business logic and enforced in code review for all subsequent HUs.

### 7. Write task files

For each task, create a file inside the new folder's `tasks/` subdirectory.

- Filename format: `<task-id>.md`
  - Example: `T-0.01-01.md`, `T-0.01-02.md`
- Content format: **Strictly follow** the template defined in `docs/templates/sub-tasks.md`.

Map the template fields as follows:

- `[N]`: Task sequence number (or use the full task ID).
- `[Short name]`: Imperative-form title (action + object).
- `Description`: Clear technical explanation of what needs to be implemented.
- `Architectural layer`: One of `Domain`, `Application`, `Infrastructure`, `Interfaces`, `Cross-cutting`.
- `Acceptance criteria`: Verifiable conditions that mark the task as done.
- `Technical dependencies`: Previous task IDs that must be completed before starting this one, or `None`.
- `Delivery dependencies`: Any later tasks or User Stories blocked by this one, or `None`.
- `Estimation`: Hours estimated for this task.
- `Suggested role`: Backend / DevOps / QA / etc.
- `Technical notes`: Links to docs, commands, references, or implementation hints.

### 8. Generate dependency tree

Create a file named `tasks/dependency-tree.md` containing:

- A textual dependency diagram (tree, Mermaid graph, or sequential list) showing the relationships between tasks.
- Identification of the **critical path** (the longest chain of dependent tasks that determines minimum duration).
- A summary table: Task ID | Title | Depends on | Estimated Hours.

### 9. Generate total estimation summary

Create a file named `tasks/estimation-summary.md` containing:

- Total hours sum.
- Hours distributed per task (table).
- Coherence check with the User Story's Story Points.
- Brief justification of the estimation.

### 10. Confirm completion

Summarize to the user:

- The folder created and its path.
- The translated User Story file name.
- The number of tasks generated.
- The total estimated hours.
- Ask if any task needs adjustment, reordering, or additional detail.

## Output format examples

### Example folder structure

```
docs/user-stories/01-mvp/00-Infraestructura conversacional MVP/
└── HU-0.01-register-telegram-bot-and-configure-webhook/
    ├── HU-0.01 — Register the bot in Telegram and configure the webhook.md
    └── tasks/
        ├── T-0.01-01.md
        ├── T-0.01-02.md
        ├── T-0.01-03.md
        ├── dependency-tree.md
        └── estimation-summary.md
```

### Example task file content

```markdown
### Task T-0.01-01: Register Telegram bot with BotFather

- **Description:** Create a new bot via BotFather, obtain the API token, and store it in the project's secret manager. Define the bot's public name and username according to the product branding.

- **Architectural layer:** `Infrastructure`

- **Acceptance criteria:**
  - [ ] Bot is registered in Telegram with a definitive name and username.
  - [ ] API token is obtained and stored in the vault/secrets manager.
  - [ ] Token is not present in source code or version control.

- **Technical dependencies (block the start):** None
- **Delivery dependencies (block the merge):** T-0.01-02

- **Estimation:** 2 hours

- **Suggested role:** DevOps / Backend

- **Technical notes:** Use the project's secret manager. Refer to `AGENTS.md` for the vault configuration.
```

## Rules

- **Always generate tasks in English**, regardless of the User Story's original language.
- **Never hardcode the tech stack** in the skill. Always read `AGENTS.md` dynamically to understand the project's conventions.
- **Always reference `docs/templates/sub-tasks.md`** for the exact task file format.
- **One file per task.** No monolithic task documents.
- **Ask for confirmation before overwriting** if the target folder already exists.
- **Delete the original file only after** the translated version is successfully written inside the new folder.
- **Preserve the original filename's story ID and separator** (including the em-dash when present) for the translated file, but replace the title with its English translation.

## References

- `docs/templates/sub-tasks.md` — Task file template (mandatory format).
- `AGENTS.md` — Project conventions, stack, and architecture rules.
- `docs/plans/plan-conventions.md` — Plan writing conventions (if task planning needs to align with project plans).
