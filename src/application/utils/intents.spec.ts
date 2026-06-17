// LAYER: Application / Tests
// Unit tests for conversational intent detection utilities.

import { describe, it, expect } from 'vitest';
import { isConfirmIntent, isCancelIntent } from './intents';

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

  it('returns true for confirm word with trailing text', () => {
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

  it('returns false for non-confirm words', () => {
    expect(isConfirmIntent('no')).toBe(false);
    expect(isConfirmIntent('cancelar')).toBe(false);
    expect(isConfirmIntent('algo random')).toBe(false);
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

  it('returns true for "para"', () => {
    expect(isCancelIntent('para')).toBe(true);
  });

  it('returns true for "stop"', () => {
    expect(isCancelIntent('stop')).toBe(true);
  });

  it('returns true for "salir"', () => {
    expect(isCancelIntent('salir')).toBe(true);
  });

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
