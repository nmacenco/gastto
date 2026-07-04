---
name: create-plan
description: Create a plan for the specified task.
disable-model-invocation: true
user-invocable: true
---

# 📜 How to create a plan

## Phase 1: Analysis (native plan mode)

Enter plan mode to explore and analyze the codebase before writing anything:

- **Claude Code**: Use the `EnterPlanMode` tool.
- **Cursor/VS Code**: Restrict yourself to only read and search tools (do not write any files during this phase).

While in plan mode:

1. Read `docs/plans/plan-conventions.md` to understand the plan structure and conventions.
2. Read the `AGENTS.md` file and the relevant documentation referenced in that file.
3. Ask the user for the task to create a plan for if not specified.
4. Explore the codebase thoroughly to understand the current state of the code related to the task.
5. Define task phases. Let the user choose between different alternatives for the amount of phases suggesting the tasks that will be implemented in each phase:
   - Minimum (1).
   - Intermediate (1-3).
   - Very granular (+3).
6. Specify public contracts to be created/modified/deleted on each phase task (see `docs/plans/plan-conventions.md` for the types of public contracts to consider). If the user does not provide them, make suggestions based on the task description.
7. Propose the plan to the user for approval. IMPORTANT: Do not proceed to Phase 2 until the user has agreed on the specific contracts and the implementation phases.

## Phase 2: Write the plan

**MANDATORY**: Exit plan mode to write the plan file:

- **Claude Code**: Use the `ExitPlanMode` tool.
- **Cursor/VS Code**: You can now write files.

1. Save the plan following the conventions in `docs/plans/plan-conventions.md`. **Path on disk**: `ai/plans/{plan-name}/{plan-name}-plan.md` (see that document for `{plan-name}`: date + semantic slug). This is the canonical location for this repository; see `AGENTS.md`.
2. Suggest next steps. Ask the user what they want to do:
   - Do not do anything else.
   - Commit the plan file to the repository by executing the `/git-commit` skill. Consider plan file only changes as `docs` type.
   - Execute the plan by executing the `/execute-plan @plan-file-path` skill.
   - Commit the plan file and execute it.

## ☝️ Considerations

### Cursor: plan file location and read-only plan mode

- **Canonical file**: Always write (or sync) the final plan Markdown under `ai/plans/{plan-name}/{plan-name}-plan.md` per `docs/plans/plan-conventions.md`. Drafting only via Cursor’s default plan surface (for example under `.cursor/plans/`) is **not** enough for this project; the content must also exist under `ai/plans/`.
- **Strict plan mode**: If the session blocks file writes, do **not** stop at a draft in the UI only. Either:
  - output the **complete** plan Markdown in the chat so the user can save it under `ai/plans/...`, or
  - ask the user to leave read-only plan mode so you can create the file directly.
- **Plan-only requests**: If the user asked for a plan only (no implementation), do not change application code or run the app; creating the plan file is the deliverable.
- **Language**: Keep the plan file body in **English**, per `docs/plans/plan-conventions.md`, even when the chat is in another language.

### 🧠 Logical reasoning

- Use AGENTS.md file as a reference while:
  - Proposing application services, domain events, tests, etc.
  - Following code conventions and architecture decisions (all inside the docs/ directory).
  - Determining the test suites and tests cases to be created/modified/deleted.
- Use available agent tools while offering different alternatives for the user to choose from:
  - `AskQuestion` tool if you are Cursor and have this tool available (only available in certain models such as Opus 4.5, not in others such as Composer 1).
  - `AskUserQuestion` tool if you are Claude Code.
