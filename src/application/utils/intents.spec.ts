// LAYER: Application / Tests
// Unit tests for conversational intent detection utilities.

import { describe, it, expect } from 'vitest';
import {
  isConfirmIntent,
  isCancelIntent,
  isUndoIntent,
  isListColumnsIntent,
  isRejectMappingIntent,
} from './intents';

describe('isConfirmIntent', () => {
  it('returns true for "sí"', () => {
    expect(isConfirmIntent('sí')).toBe(true);
  });

  it('returns true for "si" (without accent)', () => {
    expect(isConfirmIntent('si')).toBe(true);
  });

  it('returns true for "ok"', () => {
    expect(isConfirmIntent('ok')).toBe(true);
  });

  it('returns true for "dale"', () => {
    expect(isConfirmIntent('dale')).toBe(true);
  });

  it('returns true for "confirmo"', () => {
    expect(isConfirmIntent('confirmo')).toBe(true);
  });

  it('returns true for "perfecto"', () => {
    expect(isConfirmIntent('perfecto')).toBe(true);
  });

  it('returns true for "yes"', () => {
    expect(isConfirmIntent('yes')).toBe(true);
  });

  it('returns true for "bárbaro"', () => {
    expect(isConfirmIntent('bárbaro')).toBe(true);
  });

  it('returns true for "va"', () => {
    expect(isConfirmIntent('va')).toBe(true);
  });

  it('returns true for "okey"', () => {
    expect(isConfirmIntent('okey')).toBe(true);
  });

  it.each(['sí', 'si', 'ok', 'dale', 'confirmo', 'correcto', 'listo', 'va'])(
    'recognizes the standard confirmation word %s',
    (reply) => {
      expect(isConfirmIntent(reply)).toBe(true);
    },
  );

  it.each([
    ['Spain', 'vale'],
    ['Argentina', 'dale'],
    ['Argentina', 'bárbaro'],
    ['Mexico', 'va'],
    ['Mexico', 'órale'],
    ['Mexico without accent', 'orale'],
    ['Chile', 'ya'],
  ])('recognizes the %s regional variant %s', (_region, reply) => {
    expect(isConfirmIntent(reply)).toBe(true);
  });

  it('returns true for a whitespace-separated sequence of confirmation words', () => {
    expect(isConfirmIntent('sí dale')).toBe(true);
    expect(isConfirmIntent('ok perfecto')).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    expect(isConfirmIntent('  sí  ')).toBe(true);
  });

  it('returns true for uppercase', () => {
    expect(isConfirmIntent('SÍ')).toBe(true);
    expect(isConfirmIntent('OK')).toBe(true);
  });

  it('normalizes punctuation and accents', () => {
    expect(isConfirmIntent('  SÍ, correcto!  ')).toBe(true);
    expect(isConfirmIntent('BÁRBARO.')).toBe(true);
  });

  it('returns false for non-confirm words', () => {
    expect(isConfirmIntent('no')).toBe(false);
    expect(isConfirmIntent('cancelar')).toBe(false);
    expect(isConfirmIntent('algo random')).toBe(false);
    expect(isConfirmIntent('comida sí, pero el monto no')).toBe(false);
  });

  it('returns false for partial matches that are not confirm words', () => {
    expect(isConfirmIntent('signal')).toBe(false);
    expect(isConfirmIntent('daleeee')).toBe(false);
  });
});

describe('isCancelIntent', () => {
  it('returns true for "no"', () => {
    expect(isCancelIntent('no')).toBe(true);
  });

  it('returns true for "cancelar"', () => {
    expect(isCancelIntent('cancelar')).toBe(true);
  });

  it('returns true for "cancela"', () => {
    expect(isCancelIntent('cancela')).toBe(true);
  });

  it('returns true for "no registres"', () => {
    expect(isCancelIntent('no registres')).toBe(true);
  });

  it('does not treat a natural-language correction beginning with "no," as cancellation', () => {
    expect(isCancelIntent('no, fueron 15')).toBe(false);
  });

  it('returns true for "para"', () => {
    expect(isCancelIntent('para')).toBe(true);
  });

  it('returns true for "stop"', () => {
    expect(isCancelIntent('stop')).toBe(true);
  });

  it('returns true for "salir"', () => {
    expect(isCancelIntent('salir')).toBe(true);
  });

  it.each(['cancel', 'cancel it', 'do not register', 'exit'])(
    'returns true for English cancellation command %s',
    (message) => {
      expect(isCancelIntent(message)).toBe(true);
    },
  );

  it('returns true for cancel word with trailing text', () => {
    expect(isCancelIntent('no quiero')).toBe(true);
    expect(isCancelIntent('cancelar todo')).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    expect(isCancelIntent('  no  ')).toBe(true);
  });

  it('returns true for uppercase', () => {
    expect(isCancelIntent('NO')).toBe(true);
    expect(isCancelIntent('CANCELAR')).toBe(true);
  });

  it('returns false for non-cancel words', () => {
    expect(isCancelIntent('sí')).toBe(false);
    expect(isCancelIntent('ok')).toBe(false);
    expect(isCancelIntent('algo random')).toBe(false);
  });
});

describe('isUndoIntent', () => {
  it.each(['deshacer', 'UNDO', 'borrar el último', '  Deshacer  ', 'borrar   el   ultimo'])(
    'returns true for the normalized undo command %s',
    (message) => {
      expect(isUndoIntent(message)).toBe(true);
    },
  );

  it.each(['rehacer', 'deshacer el gasto anterior', 'borrar', 'último gasto', 'Hola'])(
    'returns false for the non-undo text %s',
    (message) => {
      expect(isUndoIntent(message)).toBe(false);
    },
  );
});

describe('isListColumnsIntent', () => {
  it('returns true for Spanish list-columns phrases', () => {
    expect(isListColumnsIntent('mostrar columnas')).toBe(true);
    expect(isListColumnsIntent('ver columnas')).toBe(true);
    expect(isListColumnsIntent('listar columnas')).toBe(true);
    expect(isListColumnsIntent('qué columnas hay')).toBe(true);
    expect(isListColumnsIntent('cuáles columnas disponibles')).toBe(true);
  });

  it('returns true for English list-columns phrases', () => {
    expect(isListColumnsIntent('show columns')).toBe(true);
    expect(isListColumnsIntent('list columns')).toBe(true);
    expect(isListColumnsIntent('available columns')).toBe(true);
  });

  it('returns false for non-list-columns messages', () => {
    expect(isListColumnsIntent('sí')).toBe(false);
    expect(isListColumnsIntent('la categoría está en E')).toBe(false);
    expect(isListColumnsIntent('ok')).toBe(false);
  });
});

describe('isRejectMappingIntent', () => {
  it('returns true for "no"', () => {
    expect(isRejectMappingIntent('no')).toBe(true);
  });

  it('returns true for "incorrecto"', () => {
    expect(isRejectMappingIntent('incorrecto')).toBe(true);
  });

  it('returns true for "no es correcto"', () => {
    expect(isRejectMappingIntent('no es correcto')).toBe(true);
  });

  it('returns true for "wrong"', () => {
    expect(isRejectMappingIntent('wrong')).toBe(true);
  });

  it('returns true with surrounding whitespace', () => {
    expect(isRejectMappingIntent('  no  ')).toBe(true);
  });

  it('returns true for uppercase and accents', () => {
    expect(isRejectMappingIntent('NO')).toBe(true);
    expect(isRejectMappingIntent('está mal')).toBe(true);
  });

  it('returns false for correction messages', () => {
    expect(isRejectMappingIntent('la categoría está en E')).toBe(false);
    expect(isRejectMappingIntent('el monto es columna 2')).toBe(false);
  });

  it('returns false for confirm messages', () => {
    expect(isRejectMappingIntent('sí')).toBe(false);
    expect(isRejectMappingIntent('ok')).toBe(false);
  });
});
