// LAYER: Domain
// External service ports. Allow swapping providers without
// modifying any use case (ADR-002 for LLM, ADR-004 for spreadsheets).

import type { ExtractedExpense } from '../entities/ExpenseRecord';
import type { Currency } from '../entities/User';

// ── LLMPort (ADR-002) ─────────────────────────────────────────────────────────
// Default implementation: OpenAIAdapter (gpt-4o).
// Alternative available: ClaudeAdapter (claude-sonnet-4-6).

export interface UserContext {
  defaultCurrency: Currency | null;
  categories: string[]; // active categories from the user's spreadsheet
  channel: 'telegram' | 'whatsapp';
}

export interface ConversationContext {
  userId: string;
  currentState: string;
  statePayload: Record<string, unknown> | null;
}

export interface LLMPort {
  // Extrae entidades financieras de un mensaje en lenguaje natural
  extractExpense(userMessage: string, userContext: UserContext): Promise<ExtractedExpense>;

  // Genera una respuesta en lenguaje natural para enviar al usuario
  generateResponse(prompt: string, context: ConversationContext): Promise<string>;
}

// ── SpreadsheetPort (ADR-004) ─────────────────────────────────────────────────
// Implementaciones: GoogleSheetsAdapter, ExcelOnlineAdapter.

export type CellValue = string | number | boolean | null;

export interface Row {
  index: number; // fila real en la hoja (1-based)
  values: CellValue[];
}

export interface AppendResult {
  sheet: string;
  row: number; // row index where the record ended up (ADR-006)
}

export interface SpreadsheetPort {
  // Lee filas de un rango (ej. "Gastos!A:F")
  readRows(fileId: string, range: string): Promise<Row[]>;

  // Appends a row and returns the location reference (ADR-006)
  appendRow(fileId: string, sheetName: string, values: CellValue[]): Promise<AppendResult>;

  // Deletes a row by index (for undo — E1-US-11)
  deleteRow(fileId: string, sheetName: string, rowIndex: number): Promise<void>;

  // Gets unique values from a column (for inferring categories during onboarding)
  getUniqueValues(fileId: string, columnIndex: number, sheetName: string): Promise<string[]>;

  // Obtiene encabezados de la primera fila de una hoja
  getHeaders(fileId: string, sheetName: string): Promise<string[]>;

  // Verifica acceso de lectura/escritura (append de prueba + delete inmediato)
  validateAccess(fileId: string, sheetName: string): Promise<boolean>;
}
