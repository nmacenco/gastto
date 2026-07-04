---
name: create-doc
description: Create new documentation based on the current conversation context.
disable-model-invocation: true
user-invocable: true
---

# How to create documentation

This command is intended to be executed after an interaction where the user has corrected your implementation based on team conventions that are not yet documented. Use the context from the previous conversation to generate the documentation automatically.

If it's a new conversation without previous messages, create the documentation based on the provided description and the current codebase. If you have a tool to question the user, use it to let the user decide if you find different alternatives in the codebase or something is not clear enough. If not, ask directly.

## Steps

### Step 1: Extract information from the conversation

Analyze the previous messages to identify:

1. **The convention**: What rule or practice did the user correct you on?
2. **The category**: Run `ls docs/` to see the existing categories and choose the one that best fits the topic. If none of them match, create a new category folder.
3. **The benefits**: Why does this convention matter? What problems does it prevent?
4. **Good examples**: Use the user's corrected version as the "Good" example. Can be one or multiple.
5. **Bad examples**: Use your original incorrect implementation as the "Bad" example. Can be one or multiple.
6. **Real world examples**: Any real files in the codebase that implement this convention.
7. **Exceptional cases**: Any situations mentioned where the convention might not apply.
8. **Related agreements**: Any existing documentation that relates to this convention.

### Step 2: Confirm only if necessary

Only ask the user for clarification or confirmation if:

- The convention is ambiguous or could be interpreted in multiple ways.
- The category is unclear.
- You need additional context to provide meaningful benefits.
- The user mentioned exceptions but didn't fully explain them.

If the conversation provides enough clarity, proceed directly to generating the file.

### Step 3: Generate the file

Create the documentation file following the structure and guidelines defined in ./documentation-guidelines.md.

### Step 4: Update the documentation index

Add the new file to the `docs/` tree in `AGENTS.md`, keeping the alphabetical order within its category. If you created a new category folder, add it to the tree as well.

## Important reminders

- Derive all content from the previous conversation context whenever possible. Ask only for clarification if necessary.
- Keep the tone consistent with existing documentation.
