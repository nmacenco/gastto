// CAPA: Domain
// Estado conversacional de la FSM. Derivado de las tablas
// `conversation_states` y `expense_queue` del esquema SQL (ADR-003).

export const FSM_STATES = [
  'IDLE',
  'ONBOARDING_START',
  'ONBOARDING_DRIVE',
  'ONBOARDING_FILE',
  'ONBOARDING_SHEET',
  'ONBOARDING_VALIDATING_ACCESS',
  'ONBOARDING_MAPPING',
  'ONBOARDING_CATEGORIES',
  'EXPENSE_RECEIVING',
  'EXPENSE_CLARIFYING',
  'EXPENSE_REVIEW',
  'EXPENSE_CORRECTING',
  'EXPENSE_SAVING',
  'EXPENSE_SAVING_RETRY',
] as const;

export type FsmState = (typeof FSM_STATES)[number];

export interface ConversationState {
  userId: string;
  currentState: FsmState;
  statePayload: Record<string, unknown> | null; // JSONB: datos del flujo activo
  enteredAt: Date;
  expiresAt: Date | null; // NULL = sin timeout
  updatedAt: Date;
}

// Cola de gastos pendientes (máx. 2 posiciones, 1–2). ADR-003 + E1-US-13.
export interface ExpenseQueueItem {
  id: string;
  userId: string;
  position: 1 | 2; // SMALLINT CHECK BETWEEN 1 AND 2
  rawMessage: string;
  receivedAt: Date;
  channel: 'telegram' | 'whatsapp';
}

// Transiciones válidas de la FSM. La FSM rechaza cualquier transición
// no listada aquí (principio de máquina de estados estricta).
export const FSM_TRANSITIONS: Record<FsmState, FsmState[]> = {
  IDLE: ['ONBOARDING_START', 'EXPENSE_RECEIVING'],
  ONBOARDING_START: ['ONBOARDING_START', 'ONBOARDING_DRIVE'],
  ONBOARDING_DRIVE: ['ONBOARDING_FILE', 'ONBOARDING_DRIVE', 'IDLE'],
  ONBOARDING_FILE: ['ONBOARDING_FILE', 'ONBOARDING_SHEET', 'ONBOARDING_START'],
  ONBOARDING_SHEET: ['ONBOARDING_SHEET', 'ONBOARDING_VALIDATING_ACCESS', 'ONBOARDING_START'],
  ONBOARDING_VALIDATING_ACCESS: ['ONBOARDING_MAPPING', 'ONBOARDING_SHEET', 'ONBOARDING_START'],
  ONBOARDING_MAPPING: ['ONBOARDING_MAPPING', 'ONBOARDING_CATEGORIES', 'ONBOARDING_START'],
  ONBOARDING_CATEGORIES: ['IDLE', 'ONBOARDING_CATEGORIES'],
  EXPENSE_RECEIVING: ['EXPENSE_CLARIFYING', 'EXPENSE_REVIEW'],
  EXPENSE_CLARIFYING: ['EXPENSE_REVIEW', 'IDLE'],
  EXPENSE_REVIEW: ['EXPENSE_REVIEW', 'EXPENSE_SAVING', 'EXPENSE_CORRECTING', 'IDLE'],
  EXPENSE_CORRECTING: ['EXPENSE_REVIEW', 'EXPENSE_CORRECTING'],
  EXPENSE_SAVING: ['IDLE', 'EXPENSE_SAVING_RETRY'],
  EXPENSE_SAVING_RETRY: ['IDLE'],
};

export function canTransition(from: FsmState, to: FsmState): boolean {
  return FSM_TRANSITIONS[from].includes(to);
}
