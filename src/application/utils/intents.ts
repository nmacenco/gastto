// LAYER: Application
// Shared conversational intent detection utilities.
// Centralizes confirmation and cancellation word lists used across use cases.

const CONFIRM_WORDS = [
  'si',
  'yes',
  'ok',
  'dale',
  'confirmo',
  'correcto',
  'listo',
  'va',
  'barbaro',
  'okey',
  'perfecto',
  'yep',
  'sip',
  'vale',
  'orale',
  'ya',
];

const CANCEL_WORDS = ['cancelar', 'cancela', 'para', 'stop', 'salir', 'cancel', 'exit'];

const REJECT_MAPPING_PHRASES = [
  'no',
  'incorrecto',
  'mal',
  'malo',
  'wrong',
  'no es correcto',
  'no esta bien',
  'no está bien',
  'no es eso',
  'cambiar todo',
  'rehacer',
  'otra vez',
];

const LIST_COLUMNS_PHRASES = [
  'mostrar columnas',
  'ver columnas',
  'listar columnas',
  'que columnas',
  'cuales columnas',
  'cuáles columnas',
  'show columns',
  'list columns',
  'available columns',
  'columnas disponibles',
];

const IDK_VARIANTS = [
  'no sé',
  'no se',
  'no lo se',
  'no sé cuál',
  'no se cual',
  'no lo sé',
  'no sé cual',
  'ni idea',
  'no tengo idea',
  'no se cual es',
  'no sé cual es',
  'no se cual usar',
  'no sé cual usar',
  'no se',
  'nose',
  'no sepa',
  'no c',
  'noce',
  'no se cual',
  'no sé cual',
];

export function isConfirmIntent(rawMessage: string): boolean {
  const tokens = rawMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  return tokens.length > 0 && tokens.every((token) => CONFIRM_WORDS.includes(token));
}

export function isCancelIntent(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase().trim();
  return (
    normalized === 'no' ||
    normalized.startsWith('no quiero') ||
    normalized.startsWith('no registres') ||
    normalized.startsWith('do not register') ||
    CANCEL_WORDS.some((w) => normalized === w || normalized.startsWith(w + ' '))
  );
}

export function isListColumnsIntent(rawMessage: string): boolean {
  const normalized = rawMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  return LIST_COLUMNS_PHRASES.some(
    (phrase) => normalized === phrase || normalized.includes(phrase),
  );
}

export function isRejectMappingIntent(rawMessage: string): boolean {
  const normalized = rawMessage
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return REJECT_MAPPING_PHRASES.some((phrase) => {
    if (normalized === phrase) return true;
    const boundaryPattern = new RegExp(`(?:^|\\s)${phrase}(?:\\s|$)`);
    return boundaryPattern.test(normalized);
  });
}

export function isIdkVariant(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase().trim().replace(/\s+/g, ' ');
  return IDK_VARIANTS.includes(normalized);
}
