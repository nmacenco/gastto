// CAPA: Domain
// Registro de gasto. Derivado de la tabla `expense_records`.
// Entidad central de la Épica 1.

import type { Currency } from './User';

export type CategoryConfidence = 'alta' | 'baja' | 'nula';

export interface ExpenseRecord {
  id: string;
  userId: string;
  spreadsheetId: string;
  concepto: string;
  monto: number; // NUMERIC(14,2) — siempre >= 0
  moneda: Currency;
  categoria: string | null;
  fechaGasto: Date; // DATE en BD
  medioPago: string | null;
  sheetName: string;
  rowIndex: number; // fila real en la planilla (necesario para deshacer, ADR-006)
  categoriaConfidence: CategoryConfidence | null;
  rawMessage: string; // mensaje original del usuario
  isDeleted: boolean; // soft delete (ADR-006 / E1-US-11)
  deletedAt: Date | null;
  createdAt: Date;
  savedAt: Date;
}

// Value object: dato extraído por el LLM antes del guardado
export interface ExtractedExpense {
  monto: number | null;
  moneda: Currency | null;
  categoriaRaw: string | null;
  fechaRaw: string | null;
  medioPago: string | null;
  confianzaCategoria: CategoryConfidence;
}
