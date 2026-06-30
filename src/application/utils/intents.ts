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
