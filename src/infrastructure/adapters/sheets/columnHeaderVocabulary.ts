// LAYER: Infrastructure
// Shared spreadsheet-header vocabulary used by rule-based detection and inference.

import type { GasttoField } from '../../../domain/entities/SpreadsheetConfig';

export const COLUMN_HEADER_DICTIONARY: Readonly<Record<string, GasttoField>> = {
  fecha: 'fecha',
  dia: 'fecha',
  'dia del gasto': 'fecha',
  date: 'fecha',
  day: 'fecha',
  data: 'fecha',

  monto: 'monto',
  importe: 'monto',
  total: 'monto',
  cantidad: 'monto',
  precio: 'monto',
  valor: 'monto',
  amount: 'monto',
  price: 'monto',
  quantia: 'monto',

  categoria: 'categoria',
  tipo: 'categoria',
  rubro: 'categoria',
  category: 'categoria',
  type: 'categoria',

  concepto: 'concepto',
  descripcion: 'concepto',
  detalle: 'concepto',
  observacion: 'concepto',
  description: 'concepto',
  detail: 'concepto',
  descricao: 'concepto',
  observacoes: 'concepto',

  'medio de pago': 'medio_pago',
  'forma de pago': 'medio_pago',
  'payment method': 'medio_pago',
  'meio de pagamento': 'medio_pago',
  medio_pago: 'medio_pago',

  moneda: 'moneda',
  currency: 'moneda',
  moeda: 'moneda',
};

export const NORMALIZED_COLUMN_HEADER_KEYS = Object.keys(COLUMN_HEADER_DICTIONARY);

export function normalizeColumnHeader(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

export function getExactGasttoField(value: string): GasttoField | undefined {
  return COLUMN_HEADER_DICTIONARY[normalizeColumnHeader(value)];
}
