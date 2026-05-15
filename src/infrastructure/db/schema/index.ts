// LAYER: Infrastructure
// Drizzle ORM schema — 1:1 mapping with SQL script.
// Uses `postgres` driver (not `pg`) per package.json and ADR decisions.

import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  smallint,
  numeric,
  date,
  timestamp,
  jsonb,
  bytea,
  check,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ── GRUPO 1: IDENTIDAD DE USUARIO ────────────────────────────────────────────

export const users = pgTable(
  "users",
  {
    userId: uuid("user_id").primaryKey().defaultRandom(),
    status: text("status").notNull().default("onboarding"),
    defaultCurrency: text("default_currency"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index("idx_users_status").on(t.status),
    statusCheck: check(
      "chk_users_status",
      sql`${t.status} IN ('onboarding', 'active', 'suspended')`,
    ),
    currencyCheck: check(
      "chk_users_currency",
      sql`${t.defaultCurrency} IN ('ARS','EUR','USD','MXN','GBP','BRL') OR ${t.defaultCurrency} IS NULL`,
    ),
  }),
);

export const messagingIdentities = pgTable(
  "messaging_identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    externalId: text("external_id").notNull(),
    linkedAt: timestamp("linked_at").notNull().defaultNow(),
  },
  (t) => ({
    lookupIdx: index("idx_messaging_identities_lookup").on(
      t.channel,
      t.externalId,
    ),
    userIdx: index("idx_messaging_identities_user").on(t.userId),
    channelCheck: check(
      "chk_channel",
      sql`${t.channel} IN ('telegram', 'whatsapp')`,
    ),
    uniqueIdentity: uniqueIndex("uq_channel_external").on(
      t.channel,
      t.externalId,
    ),
  }),
);

// ── GRUPO 2: ESTADO CONVERSACIONAL ───────────────────────────────────────────

export const conversationStates = pgTable(
  "conversation_states",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.userId, { onDelete: "cascade" }),
    currentState: text("current_state").notNull().default("IDLE"),
    statePayload: jsonb("state_payload"),
    enteredAt: timestamp("entered_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    expiresIdx: index("idx_conversation_states_expires").on(t.expiresAt),
    stateIdx: index("idx_conversation_states_current").on(t.currentState),
  }),
);

export const expenseQueue = pgTable(
  "expense_queue",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    position: smallint("position").notNull(),
    rawMessage: text("raw_message").notNull(),
    receivedAt: timestamp("received_at").notNull().defaultNow(),
    channel: text("channel").notNull(),
  },
  (t) => ({
    userPositionIdx: index("idx_expense_queue_user_position").on(
      t.userId,
      t.position,
    ),
    uniqueUserPosition: uniqueIndex("uq_user_position").on(
      t.userId,
      t.position,
    ),
    positionRange: check(
      "chk_position_range",
      sql`${t.position} BETWEEN 1 AND 2`,
    ),
    channelCheck: check(
      "chk_queue_channel",
      sql`${t.channel} IN ('telegram', 'whatsapp')`,
    ),
  }),
);

// ── GRUPO 3: OAUTH ───────────────────────────────────────────────────────────

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    accessTokenEnc: bytea("access_token_enc").notNull(), // AES-256-GCM (ADR-007)
    refreshTokenEnc: bytea("refresh_token_enc").notNull(), // AES-256-GCM
    iv: bytea("iv").notNull(), // initialization vector
    accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
    scope: text("scope")
      .array()
      .notNull()
      .default(sql`'{}'`),
    grantedAt: timestamp("granted_at").notNull().defaultNow(),
    lastRefreshedAt: timestamp("last_refreshed_at"),
    revokedAt: timestamp("revoked_at"),
  },
  (t) => ({
    userProviderIdx: index("idx_oauth_tokens_user_provider").on(
      t.userId,
      t.provider,
    ),
    expiresIdx: index("idx_oauth_tokens_expires").on(t.accessTokenExpiresAt),
    uniqueUserProvider: uniqueIndex("uq_user_provider").on(
      t.userId,
      t.provider,
    ),
    providerCheck: check(
      "chk_provider",
      sql`${t.provider} IN ('google', 'microsoft')`,
    ),
  }),
);

// ── GRUPO 4: CONFIGURACIÓN DE PLANILLA ───────────────────────────────────────

export const spreadsheetConfigs = pgTable(
  "spreadsheet_configs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    fileId: text("file_id").notNull(),
    fileName: text("file_name").notNull(),
    sheetName: text("sheet_name").notNull(),
    accessVerifiedAt: timestamp("access_verified_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("idx_spreadsheet_configs_user").on(t.userId),
    uniqueUser: uniqueIndex("uq_user_spreadsheet").on(t.userId),
    providerCheck: check(
      "chk_sp_provider",
      sql`${t.provider} IN ('google', 'microsoft')`,
    ),
  }),
);

export const columnMappings = pgTable(
  "column_mappings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheetConfigs.id, { onDelete: "cascade" }),
    GasttoField: text("Gastto_field").notNull(),
    columnIndex: smallint("column_index").notNull(),
    columnHeader: text("column_header").notNull(),
    inferred: boolean("inferred").notNull().default(true),
    confirmedAt: timestamp("confirmed_at"),
  },
  (t) => ({
    spreadsheetIdx: index("idx_column_mappings_spreadsheet").on(
      t.spreadsheetId,
    ),
    uniqueField: uniqueIndex("uq_spreadsheet_field").on(
      t.spreadsheetId,
      t.GasttoField,
    ),
    uniqueColumn: uniqueIndex("uq_spreadsheet_column").on(
      t.spreadsheetId,
      t.columnIndex,
    ),
    fieldCheck: check(
      "chk_Gastto_field",
      sql`${t.GasttoField} IN ('monto','moneda','categoria','fecha','concepto','medio_pago')`,
    ),
  }),
);

export const userCategories = pgTable(
  "user_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheetConfigs.id, { onDelete: "cascade" }),
    rawValue: text("raw_value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    usageCount: integer("usage_count").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    spreadsheetIdx: index("idx_user_categories_spreadsheet").on(
      t.spreadsheetId,
    ),
    uniqueCategory: uniqueIndex("uq_spreadsheet_category").on(
      t.spreadsheetId,
      t.normalizedValue,
    ),
  }),
);

// ── GRUPO 5: REGISTRO DE GASTOS ───────────────────────────────────────────────

export const expenseRecords = pgTable(
  "expense_records",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    spreadsheetId: uuid("spreadsheet_id")
      .notNull()
      .references(() => spreadsheetConfigs.id),
    concepto: text("concepto").notNull(),
    monto: numeric("monto", { precision: 14, scale: 2 }).notNull(),
    moneda: text("moneda").notNull(),
    categoria: text("categoria"),
    fechaGasto: date("fecha_gasto").notNull(),
    medioPago: text("medio_pago"),
    sheetName: text("sheet_name").notNull(),
    rowIndex: integer("row_index").notNull(),
    categoriaConfidence: text("categoria_confidence"),
    rawMessage: text("raw_message").notNull(),
    isDeleted: boolean("is_deleted").notNull().default(false),
    deletedAt: timestamp("deleted_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    savedAt: timestamp("saved_at").notNull().defaultNow(),
  },
  (t) => ({
    userLatestIdx: index("idx_expense_records_user_latest").on(
      t.userId,
      t.savedAt,
    ),
    userFechaIdx: index("idx_expense_records_user_fecha").on(
      t.userId,
      t.fechaGasto,
    ),
    sheetRowIdx: index("idx_expense_records_sheet_row").on(
      t.spreadsheetId,
      t.sheetName,
      t.rowIndex,
    ),
    montoCheck: check("chk_monto", sql`${t.monto} >= 0`),
    monedaCheck: check(
      "chk_moneda",
      sql`${t.moneda} IN ('ARS','EUR','USD','MXN','GBP','BRL')`,
    ),
    confidenceCheck: check(
      "chk_confidence",
      sql`${t.categoriaConfidence} IN ('alta','baja','nula') OR ${t.categoriaConfidence} IS NULL`,
    ),
  }),
);

// ── GRUPO 7: AUDITORÍA ───────────────────────────────────────────────────────

export const operationLogs = pgTable(
  "operation_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.userId, { onDelete: "cascade" }),
    operation: text("operation").notNull(),
    payload: jsonb("payload"),
    errorType: text("error_type"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    userCreatedIdx: index("idx_operation_logs_user_created").on(
      t.userId,
      t.createdAt,
    ),
    failuresIdx: index("idx_operation_logs_failures").on(t.createdAt),
  }),
);
