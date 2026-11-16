# Conversational message formatting

## Implemented scope

File and sheet selection and spreadsheet recovery messages use explicit paragraphs to separate explanations, actions, and optional cancellation. This applies to onboarding copies, settings destination selection, and shared spreadsheet recovery copies. Existing short confirmations remain concise.

Onboarding and settings recovery, OAuth guidance, mapping corrections, category errors, payment setup, and access replacement messages also follow the convention. Existing structured summaries and short acknowledgements retain their layout. Expense messages and the final cross-flow audit remain pending under phases 3–4 of the [readability plan](../../ai/plans/2026_11_15-readable_conversation_messages/2026_11_15-readable_conversation_messages-plan.md).

## Composition contract

`composeMessage({ explanation?, action?, exit? }): string` in `src/application/copies/compose-message.ts` renders the supplied blocks in that order, separated by one blank line (`\n\n`). It trims block boundaries and omits absent or whitespace-only blocks. It preserves internal paragraphs, list indentation, URLs, and punctuation. An empty composition returns an empty string; callers must not send it.

Copy modules own wording and explicit list structure. The composer does not infer structure from punctuation or inspect conversation state. Each message is still passed as one string to the messaging port; existing transport fragmentation remains in place.

- Keep each intention in its own paragraph.
- Use numbered lists for ordered recovery steps and preserve selectable option numbers.
- Keep list items on separate lines and preserve nested indentation.
- Optional cancellation uses the exact shared text `Escribí cancelar si quieres salir.`, separated from the preceding block by a blank line.
- Only flows that already offer cancellation supply that footer.
- Required cancellation and restart instructions belong in the action sequence and do not receive an additional optional footer.

## Examples

Retryable read failure:

```text
No pude consultar la planilla por un problema temporal.

En unos segundos, enviá reintentar para volver a intentar.

Escribí cancelar si quieres salir.
```

Permanent settings read failure:

```text
No pude leer las hojas o su estructura.

Revisá el archivo en Google Sheets. Para elegir otro archivo:
1. Escribí cancelar para salir de la configuración actual.
2. Escribí configuración.
3. Elegí la opción 3.
```

Onboarding uses `empezar` for the restart. Retryable failures retain their context-specific command, including `otra hoja`, `no sé`, and `la misma selección` where applicable.

## Validation

Composer tests cover block ordering, empty blocks, boundary trimming, internal paragraphs, nested indentation, and URLs. Recovery-copy tests assert complete representative messages, retry commands, both restart flows, and list/footer separation. Existing file/sheet selection and settings tests continue to cover candidate preservation and guarded state changes.

## Shared browser output

OAuth failure copies are reused in chat and in the callback HTML. The callback escapes HTML characters first, then replaces newlines with `<br>` to preserve paragraph boundaries without interpreting message content as markup. Initial admission errors remain distinct from cancellable replacement-email errors.

Setup-formatting tests assert full menus, column lists, nested categories, payment examples, replacement-email errors, and OAuth URLs. Callback tests verify paragraph rendering together with HTML escaping.
