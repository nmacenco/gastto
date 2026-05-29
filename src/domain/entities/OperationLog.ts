// CAPA: Domain
// Log de auditoría de operaciones. Derivado de la tabla `operation_logs`.
// Inmutable por diseño: solo se inserta, nunca se modifica.

export type OperationType =
  | 'EXPENSE_SAVED'
  | 'EXPENSE_DELETED'
  | 'EXPENSE_SAVE_FAILED'
  | 'TOKEN_REFRESHED'
  | 'TOKEN_REVOKED'
  | 'ONBOARDING_COMPLETED'
  | 'MAPPING_UPDATED'
  | 'STATE_CORRUPTED';

export type ErrorType = 'NETWORK_ERROR' | 'AUTH_ERROR' | 'STRUCTURE_ERROR' | 'CORRUPTED_STATE';

export interface OperationLog {
  id: string;
  userId: string;
  operation: OperationType;
  payload: Record<string, unknown> | null; // JSONB: contexto de la operación
  errorType: ErrorType | null; // solo en operaciones fallidas
  createdAt: Date;
}
