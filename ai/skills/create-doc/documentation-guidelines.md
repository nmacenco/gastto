# 🎯 Documentation guidelines

## Structure

Each documentation file follows this template:

```markdown
# 🎯 [Category]: [Title]

## 💡 Convention

[Convention summary - 1-2 sentences explaining the rule.]

## 🏆 Benefits

- [Benefit 1.]
- [Benefit 2.]
- [Benefit 3.]

## 👀 Examples

### ✅ Good: [Brief description of the good practice]

[Code block or description.]

### ❌ Bad: [Brief description of the bad practice]

[Code block or description.]

## 🧐 Real world examples

- [`Service/File Name`](./path/to/file.ts)
- [`Another Module`](./path/to/another/file.ts)

## ☝️ Exceptional cases: When to not take into account this convention

[List of cases where exceptions are valid.]

### 🥽 Example of exceptional case

[Description of the exceptional case context.]

[Code block or description showing the valid exception.]

## 🔗 Related agreements

- [Related agreement title](./path-to-related-agreement.md).
- [Another related agreement](./path-to-another-agreement.md).
```

## Title and file name

The filename is critical: AI agents use it to decide whether to load the document or not. A descriptive filename ensures the convention is discovered and applied; a vague one means it will be ignored.

Use kebab-case for the filename, derived from the title. Reflect in the title and filename the actual convention instead of the generic category or concept. That is, if the convention is about "API route organization", the title should be "API Route Organization by Domain" instead of "API Route Organization", and the filename should be `api-route-organization-by-domain.md` instead of `api-route-organization.md`.

Examples:

- "Use cases organization" → `use-cases-organization.md`.
- "Use NOT NULL in fields" → `not-null-fields.md`.
- "Avoid premature abstractions" → `avoid-premature-abstractions.md`.
- "Repository pattern implementation" → `repository-pattern-implementation.md`.

## Good and bad examples

- Use H4 (`####`) sub-headings only when there are multiple examples within a good or bad section.
- Use the appropriate code language in fenced code blocks.
- Avoid code comments in the example snippets. Provide a brief description between the heading and the code block only if really necessary. It is important to keep the examples as brief as possible, so try to avoid adding a description if you can already express the idea in the example heading.

## Optional sections

- If the convention doesn't have exceptional cases, omit the "Exceptional cases" section entirely.
- If there are no real world examples, omit the "Real world examples" section entirely.
- If there are no related agreements, omit the "Related agreements" section entirely.
- If a bad example doesn't add value or doesn't make sense for a particular case, omit it.

## Language

All documentation must be written in **English** — filenames, headings, body text, code comments, and examples. This applies to both `docs/` files and skills under `ai/skills/`.

## Style

- Maximize information density: convey as much as possible in as few words as possible.
- End each phrase with a period, including bullet point items.
- Avoid documenting with the whole phrase in strong emphasis.

## Reference example

See [`docs/adr/`](./adr/) for complete, real-world documents that follow this template.
