// LAYER: Domain
// Repository interfaces (persistence ports).
// Dependency Inversion Principle: Domain layer defines
// WHAT operations it needs; Infrastructure decides HOW to implement them.
// No imports of Drizzle, postgres, or any ORM here.

import type { User, MessagingIdentity } from '../entities/User';
import type { ConversationState, ExpenseQueueItem } from '../entities/ConversationState';
import type { ExpenseRecord } from '../entities/ExpenseRecord';
import type {
  SpreadsheetConfig,
  ColumnMapping,
  UserCategory,
  OAuthToken,
} from '../entities/SpreadsheetConfig';
import type { OperationLog, OperationType, ErrorType } from '../entities/OperationLog';

// ── Usuario ─────────────────────────────────────────────────────────────────

export interface IUserRepository {
  findById(userId: string): Promise<User | null>;

  // Identity resolution: (channel, externalId) → User
  // Cached in Redis by the adapter (ADR-008). If not exists → null.
  findByMessagingIdentity(
    channel: 'telegram' | 'whatsapp',
    externalId: string,
  ): Promise<User | null>;

  // Crea User + MessagingIdentity en una sola transacción
  createWithIdentity(
    channel: 'telegram' | 'whatsapp',
    externalId: string,
  ): Promise<{ user: User; identity: MessagingIdentity }>;

  updateStatus(userId: string, status: User['status']): Promise<void>;
  updateDefaultCurrency(userId: string, currency: User['defaultCurrency']): Promise<void>;

  // Lookup messaging identities by userId (for session timeout notifications)
  findMessagingIdentitiesByUserId(userId: string): Promise<MessagingIdentity[]>;
}

// ── Estado conversacional (FSM) ──────────────────────────────────────────────

export interface IConversationStateRepository {
  findByUserId(userId: string): Promise<ConversationState | null>;

  // Crea el estado inicial IDLE para un usuario recién creado
  create(userId: string): Promise<ConversationState>;

  // Actualiza estado y payload en una sola operación atómica
  transition(
    userId: string,
    nextState: ConversationState['currentState'],
    payload: Record<string, unknown> | null,
    expiresAt: Date | null,
  ): Promise<ConversationState>;

  // Encuentra estados expirados (para el job BullMQ de timeout)
  findExpired(): Promise<ConversationState[]>;
}

// ── Cola de gastos ────────────────────────────────────────────────────────────

export interface IExpenseQueueRepository {
  findByUserId(userId: string): Promise<ExpenseQueueItem[]>;
  enqueue(
    userId: string,
    rawMessage: string,
    channel: 'telegram' | 'whatsapp',
  ): Promise<ExpenseQueueItem>;
  dequeueFirst(userId: string): Promise<ExpenseQueueItem | null>;
  countByUserId(userId: string): Promise<number>;
  clearByUserId(userId: string): Promise<void>;
}

// ── OAuth ─────────────────────────────────────────────────────────────────────

export interface IOAuthTokenRepository {
  findByUserAndProvider(
    userId: string,
    provider: OAuthToken['provider'],
  ): Promise<OAuthToken | null>;

  upsert(token: Omit<OAuthToken, 'id'>): Promise<OAuthToken>;

  markRefreshed(
    id: string,
    newAccessTokenEnc: Buffer,
    newIv: Buffer,
    newExpiresAt: Date,
  ): Promise<void>;

  markRevoked(id: string): Promise<void>;
}

// ── Configuración de planilla ─────────────────────────────────────────────────

export interface ISpreadsheetConfigRepository {
  findByUserId(userId: string): Promise<SpreadsheetConfig | null>;
  create(
    config: Omit<SpreadsheetConfig, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<SpreadsheetConfig>;
  updateAccessVerified(id: string): Promise<void>;
}

export interface IColumnMappingRepository {
  findBySpreadsheetId(spreadsheetId: string): Promise<ColumnMapping[]>;
  upsertMany(mappings: Omit<ColumnMapping, 'id'>[]): Promise<void>;
  confirm(id: string): Promise<void>;

  // Marks every mapping for a spreadsheet as confirmed (e.g. user said "yes"/"ok")
  confirmBySpreadsheetId(spreadsheetId: string): Promise<void>;

  // Updates a single mapping after a user correction (column, header, inferred flag)
  updateCorrected(mapping: Partial<ColumnMapping> & { id: string }): Promise<void>;
}

export interface IUserCategoryRepository {
  findActiveBySpreadsheetId(spreadsheetId: string): Promise<UserCategory[]>;
  upsertMany(categories: Omit<UserCategory, 'id' | 'createdAt'>[]): Promise<void>;
  incrementUsage(id: string): Promise<void>;
}

// ── Registros de gasto ────────────────────────────────────────────────────────

export interface IExpenseRecordRepository {
  create(record: Omit<ExpenseRecord, 'id' | 'createdAt' | 'savedAt'>): Promise<ExpenseRecord>;

  // Último registro no eliminado del usuario (para deshacer — E1-US-11)
  findLatestByUserId(userId: string): Promise<ExpenseRecord | null>;

  // Soft delete (ADR-006): marca is_deleted = true, deleted_at = now()
  softDelete(id: string): Promise<void>;
}

// ── Auditoría ─────────────────────────────────────────────────────────────────

export interface IOperationLogRepository {
  create(
    userId: string,
    operation: OperationType,
    payload?: Record<string, unknown>,
    errorType?: ErrorType,
  ): Promise<OperationLog>;
}
