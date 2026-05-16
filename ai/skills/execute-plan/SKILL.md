---
name: execute-plan
description: Execute the plan specified by the user.
disable-model-invocation: true
user-invocable: true
---

IMPORTANT: Perform only the to-do actions of the current phase.

# How to execute a plan

1. Read `docs/plans/plan-conventions.md` to understand the plan structure and conventions.
2. Ask the user for the plan to execute if not already specified.
3. Execute the to-do actions of the current phase.
4. Check the checkboxes of the current phase to-do list that have been completed.
5. Update the plan next step section with the next phase to be completed.
6.  Ask user to choose if they want to commit the changes done in the current phase. If they do, make another question to the user asking them to select a commit message between 3-5 alternatives following the commit message convention defined in the @../../docs/git/commit-messages.md file.

## When the last phase is completed

When all phases are done, suggest the user to export the conversation (using their IDE) and store it as a `.md` file alongside the related plan. Example: if the plan is `ai/plans/2026_02_11-sync_cbd_with_stripe/2026_02_11-sync_cbd_with_stripe-plan.md`, suggest storing the conversation as `ai/plans/2026_02_11-sync_cbd_with_stripe/2026_02_11-sync_cbd_with_stripe-conversation.md`.

## ☝️ Considerations

## 🎨 UI code rules (read before writing any component or JSX)

Before writing or modifying any component, verify these rules from `docs/design/ui.md`:
- Use Tailwind classes instead of `style={{}}`. Inline styles are only allowed for runtime-computed values with no static CSS equivalent (e.g. dynamic colors with opacity, runtime CSS variable overrides).
- Even if the surrounding file already uses inline styles, new code must use Tailwind.

## 🧠 Logical reasoning

- Use AGENTS.md file as a reference while:
  - Proposing application services, domain events, tests, etc.
  - Following code conventions and architecture decisions (all inside the docs/ directory).
  - Determining the test suites and tests cases to be created/modified/deleted.
- Use available agent tools while offering different alternatives for the user to choose from:
  - `AskQuestion` tool if you are Cursor and have this tool available (only available in certain models such as Opus 4.5, not in others such as Composer 1).
  - `AskUserQuestion` tool if you are Claude Code.
