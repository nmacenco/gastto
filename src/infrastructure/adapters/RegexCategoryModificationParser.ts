// LAYER: Infrastructure
// Lightweight rule-based parser for category modification intents.
// Supports Spanish and English add/rename patterns without LLM overhead.
// Swappable with an LLM-based parser via the CategoryModificationParserPort.

import {
  type CategoryModificationParserPort,
  type CategoryModificationIntent,
} from '../../domain/ports/categoryModificationParser';

function normalizeInput(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract the category name after common add-prefix phrases
function extractAddName(normalized: string): string | null {
  const addPatterns = [
    /^falta\s+(la\s+)?(categoria\s+)?(.+)$/,
    /^agregar\s+(la\s+)?(categoria\s+)?(.+)$/,
    /^agrega\s+(la\s+)?(categoria\s+)?(.+)$/,
    /^anadir\s+(la\s+)?(categoria\s+)?(.+)$/,
    /^add\s+(the\s+)?(category\s+)?(.+)$/,
    /^missing\s+(the\s+)?(category\s+)?(.+)$/,
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

// Extract from/to names for rename intents
function extractRenameParts(normalized: string): { from: string; to: string } | null {
  const renamePatterns = [
    // Spanish: "ocio se llama entretenimiento", "la categoria ocio es entretenimiento"
    /^(la\s+)?(categoria\s+)?(.+?)\s+se\s+llama\s+(.+)$/,
    /^(la\s+)?(categoria\s+)?(.+?)\s+es\s+(.+)$/,
    /^(la\s+)?(categoria\s+)?(.+?)\s+deberia\s+ser\s+(.+)$/,
    // English: "leisure is actually entertainment", "leisure should be entertainment"
    /^(the\s+)?(category\s+)?(.+?)\s+is\s+actually\s+(.+)$/,
    /^(the\s+)?(category\s+)?(.+?)\s+should\s+be\s+(.+)$/,
    /^(the\s+)?(category\s+)?(.+?)\s+is\s+(.+)$/,
    /^rename\s+(the\s+)?(category\s+)?(.+?)\s+to\s+(.+)$/,
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

    // Try rename first (more specific patterns)
    const renameParts = extractRenameParts(normalized);
    if (renameParts) {
      return Promise.resolve({
        kind: 'rename',
        from: renameParts.from,
        to: renameParts.to,
      });
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
