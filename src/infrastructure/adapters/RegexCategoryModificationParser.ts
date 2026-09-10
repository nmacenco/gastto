// LAYER: Infrastructure
// Lightweight rule-based parser for category modification intents.
// Supports Spanish and English add/remove/rename patterns without LLM overhead.
// Swappable with an LLM-based parser via the CategoryModificationParserPort.

import {
  type CategoryModificationParserPort,
  type CategoryModificationIntent,
} from '../../domain/ports/categoryModificationParser';

function normalizeInput(input: string): string {
  return input
    .replace(/\s+/g, ' ')
    .replace(/^[¡!¿?.,;:\s]+|[¡!¿?.,;:\s]+$/gu, '')
    .trim();
}

function cleanName(value: string | undefined): string | null {
  const name = value?.trim();
  return name ? name : null;
}

function matchParts(
  input: string,
  patterns: readonly RegExp[],
  keys: readonly string[],
): Record<string, string> | null {
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match) continue;

    const result: Record<string, string> = {};
    let complete = true;
    for (const key of keys) {
      const value = cleanName(match.groups?.[key]);
      if (!value) {
        complete = false;
        break;
      }
      result[key] = value;
    }
    if (complete) return result;
  }
  return null;
}

function extractMoveSubcategory(input: string) {
  return matchParts(
    input,
    [
      /^(?:move)\s+(?:the\s+)?(?:subcategory\s+)?(?<name>.+?)\s+from\s+(?:category\s+)?(?<fromParent>.+?)\s+to\s+(?:category\s+)?(?<toParent>.+)$/iu,
      /^(?:mover|mueve)\s+(?:la\s+)?(?:subcategor[ií]a\s+)?(?<name>.+?)\s+de\s+(?:la\s+categor[ií]a\s+)?(?<fromParent>.+?)\s+a\s+(?:la\s+categor[ií]a\s+)?(?<toParent>.+)$/iu,
    ],
    ['name', 'fromParent', 'toParent'],
  );
}

function extractRenameSubcategory(input: string) {
  return matchParts(
    input,
    [
      /^(?:under|in)\s+(?:category\s+)?(?<parent>.+?)(?:\s*[,;:]\s*|\s+)rename\s+(?:the\s+)?(?:subcategory\s+)?(?<from>.+?)\s+to\s+(?<to>.+)$/iu,
      /^(?:bajo|en)\s+(?:la\s+categor[ií]a\s+)?(?<parent>.+?)(?:\s*[,;:]\s*|\s+)(?:renombra|renombrar|cambia)\s+(?:la\s+)?(?:subcategor[ií]a\s+)?(?<from>.+?)\s+(?:a|por)\s+(?<to>.+)$/iu,
    ],
    ['parent', 'from', 'to'],
  );
}

function extractRemoveSubcategory(input: string) {
  return matchParts(
    input,
    [
      /^(?:remove|delete)\s+(?:the\s+)?(?:subcategory\s+)?(?<name>.+?)\s+from\s+(?:category\s+)?(?<parent>.+)$/iu,
      /^(?:quitar|quita|eliminar|elimina|borrar|borra)\s+(?:la\s+)?(?:subcategor[ií]a\s+)?(?<name>.+?)\s+de\s+(?:la\s+categor[ií]a\s+)?(?<parent>.+)$/iu,
    ],
    ['name', 'parent'],
  );
}

function extractAddSubcategory(input: string) {
  return matchParts(
    input,
    [
      /^(?:add)\s+(?:the\s+)?(?:subcategory\s+)?(?<name>.+?)\s+(?:to|under)\s+(?:the\s+)?(?:category\s+)?(?<parent>.+)$/iu,
      /^(?:agregar|agrega|a[nñ]adir|a[nñ]ade)\s+(?:la\s+)?(?:subcategor[ií]a\s+)?(?<name>.+?)\s+(?:a|en|bajo)\s+(?:la\s+)?(?:categor[ií]a\s+)?(?<parent>.+)$/iu,
    ],
    ['name', 'parent'],
  );
}

function looksLikeIncompleteSubcategoryCommand(input: string): boolean {
  return (
    /\b(?:subcategory|subcategor[ií]a|under|bajo|from|move|mover|mueve)\b/iu.test(input) ||
    /\b(?:to|a|en|de)\s*$/iu.test(input)
  );
}

// Extract the category name after common add-prefix phrases
function extractAddName(normalized: string): string | null {
  const addPatterns = [
    /^falta\s+(la\s+)?(categor[ií]a\s+)?(.+)$/iu,
    /^agregar\s+(la\s+)?(categor[ií]a\s+)?(.+)$/iu,
    /^agrega\s+(la\s+)?(categor[ií]a\s+)?(.+)$/iu,
    /^a[nñ]adir\s+(la\s+)?(categor[ií]a\s+)?(.+)$/iu,
    /^add\s+(the\s+)?(category\s+)?(.+)$/iu,
    /^missing\s+(the\s+)?(category\s+)?(.+)$/iu,
  ];

  for (const pattern of addPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const name = match[3]?.trim();
      if (name && name.length > 0) return name;
    }
  }

  return null;
}

function extractRemoveName(normalized: string): string | null {
  const removePatterns = [
    /^(?:quitar|quita|eliminar|elimina|borrar|borra)\s+(?:la\s+)?(?:categor[ií]a\s+)?(.+)$/iu,
    /^(?:remove|delete)\s+(?:the\s+)?(?:category\s+)?(.+)$/iu,
  ];

  for (const pattern of removePatterns) {
    const match = normalized.match(pattern);
    const name = match?.[1]?.trim();
    if (name) return name;
  }

  return null;
}

// Extract from/to names for rename intents
function extractRenameParts(normalized: string): { from: string; to: string } | null {
  const renamePatterns = [
    // Spanish: "ocio se llama entretenimiento", "la categoria ocio es entretenimiento"
    /^(la\s+)?(categor[ií]a\s+)?(.+?)\s+se\s+llama\s+(.+)$/iu,
    /^(la\s+)?(categor[ií]a\s+)?(.+?)\s+es\s+(.+)$/iu,
    /^(la\s+)?(categor[ií]a\s+)?(.+?)\s+deber[ií]a\s+ser\s+(.+)$/iu,
    // English: "leisure is actually entertainment", "leisure should be entertainment"
    /^(the\s+)?(category\s+)?(.+?)\s+is\s+actually\s+(.+)$/iu,
    /^(the\s+)?(category\s+)?(.+?)\s+should\s+be\s+(.+)$/iu,
    /^(the\s+)?(category\s+)?(.+?)\s+is\s+(.+)$/iu,
    /^rename\s+(the\s+)?(category\s+)?(.+?)\s+to\s+(.+)$/iu,
  ];

  for (const pattern of renamePatterns) {
    const match = normalized.match(pattern);
    if (match) {
      const from = match[3]?.trim();
      const to = match[4]?.trim();
      if (from && to && from.length > 0 && to.length > 0) {
        return { from, to };
      }
    }
  }

  return null;
}

export class RegexCategoryModificationParser implements CategoryModificationParserPort {
  parse(input: string): Promise<CategoryModificationIntent> {
    const normalized = normalizeInput(input);

    const move = extractMoveSubcategory(normalized);
    if (move) {
      return Promise.resolve({
        kind: 'move-subcategory',
        name: move.name!,
        fromParent: move.fromParent!,
        toParent: move.toParent!,
      });
    }

    const childRename = extractRenameSubcategory(normalized);
    if (childRename) {
      return Promise.resolve({
        kind: 'rename-subcategory',
        from: childRename.from!,
        to: childRename.to!,
        parent: childRename.parent!,
      });
    }

    const childRemove = extractRemoveSubcategory(normalized);
    if (childRemove) {
      return Promise.resolve({
        kind: 'remove-subcategory',
        name: childRemove.name!,
        parent: childRemove.parent!,
      });
    }

    const childAdd = extractAddSubcategory(normalized);
    if (childAdd) {
      return Promise.resolve({
        kind: 'add-subcategory',
        name: childAdd.name!,
        parent: childAdd.parent!,
      });
    }

    if (looksLikeIncompleteSubcategoryCommand(normalized)) {
      return Promise.resolve({ kind: 'unknown' });
    }

    // Try rename first (more specific patterns)
    const renameParts = extractRenameParts(normalized);
    if (renameParts) {
      return Promise.resolve({
        kind: 'rename',
        from: renameParts.from,
        to: renameParts.to,
      });
    }

    const removeName = extractRemoveName(normalized);
    if (removeName) {
      return Promise.resolve({ kind: 'remove', name: removeName });
    }

    // Try add
    const addName = extractAddName(normalized);
    if (addName) {
      return Promise.resolve({
        kind: 'add',
        name: addName,
      });
    }

    return Promise.resolve({ kind: 'unknown' });
  }
}
