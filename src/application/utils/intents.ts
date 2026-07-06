// LAYER: Application
// Shared conversational intent detection utilities.
// Centralizes confirmation and cancellation word lists used across use cases.

const CONFIRM_WORDS = [
  'sí',
  'si',
  'yes',
  'ok',
  'dale',
  'confirmo',
  'correcto',
  'listo',
  'va',
  'bárbaro',
  'okey',
  'perfecto',
  'yep',
  'sip',
];

const CANCEL_WORDS = ['no', 'cancelar', 'cancela', 'no registres', 'para', 'stop', 'salir'];

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

export function isConfirmIntent(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase().trim();
  return CONFIRM_WORDS.some((w) => normalized === w || normalized.startsWith(w + ' '));
}

export function isCancelIntent(rawMessage: string): boolean {
  const normalized = rawMessage.toLowerCase().trim();
  return CANCEL_WORDS.some((w) => normalized === w || normalized.startsWith(w));
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
