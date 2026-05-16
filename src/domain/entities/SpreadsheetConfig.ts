// LAYER: Domain
// Spreadsheet and OAuth configuration entities.
// Derived from: spreadsheet_configs, column_mappings, user_categories, oauth_tokens.

export type SpreadsheetProvider = 'google' | 'microsoft';

// Campos que Gastto mapea a columnas de la planilla del usuario
export type GasttoField = 'monto' | 'moneda' | 'categoria' | 'fecha' | 'concepto' | 'medio_pago';

export interface SpreadsheetConfig {
  id: string;
  userId: string;
  provider: SpreadsheetProvider;
  fileId: string;
  fileName: string;
  sheetName: string;
  accessVerifiedAt: Date; // last permission verification (ADR-004)
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnMapping {
  id: string;
  spreadsheetId: string;
  GasttoField: GasttoField;
  columnIndex: number; // column index (0-based or 1-based, to define in implementation)
  columnHeader: string; // actual header read from the spreadsheet
  inferred: boolean; // true = inferido por LLM, false = confirmado por usuario
  confirmedAt: Date | null;
}

export interface UserCategory {
  id: string;
  spreadsheetId: string;
  rawValue: string; // value as it appears in the spreadsheet ("Delivery", "food", etc.)
  normalizedValue: string; // normalized for comparison ("food")
  usageCount: number;
  isActive: boolean;
  createdAt: Date;
}

// Tokens OAuth. access_token_enc y refresh_token_enc son BYTEA en BD
// (cifrados con AES-256-GCM, ADR-007). En el dominio los representamos
// como Buffer para que la capa de infraestructura gestione el cifrado.
export interface OAuthToken {
  id: string;
  userId: string;
  provider: SpreadsheetProvider;
  accessTokenEnc: Buffer; // BYTEA — cifrado en reposo
  refreshTokenEnc: Buffer; // BYTEA — cifrado en reposo
  iv: Buffer; // BYTEA — initialization vector AES-256-GCM
  accessTokenExpiresAt: Date;
  scope: string[];
  grantedAt: Date;
  lastRefreshedAt: Date | null;
  revokedAt: Date | null;
}
