import type { GasttoField, SpreadsheetProvider } from '../../../domain/entities/SpreadsheetConfig';
import { normalizePaymentMethodName } from '../../../domain/entities/PaymentMethodCatalog';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';

export interface PaymentMethodProposal {
  names: string[];
  columnMapped: boolean;
}

export class DetectPaymentMethods {
  constructor(
    private readonly deps: {
      tokenService: OAuthAccessTokenProvider;
      spreadsheetPortFactory: SpreadsheetPortFactory;
    },
  ) {}

  async execute(input: {
    userId: string;
    provider: SpreadsheetProvider;
    fileId: string;
    sheetName: string;
    mappings: readonly { field: GasttoField; columnIndex: number }[];
    headerRowIndex: number;
  }): Promise<PaymentMethodProposal> {
    const mapping = input.mappings.find((item) => item.field === 'medio_pago');
    if (!mapping) return { names: [], columnMapped: false };
    if (
      !Number.isInteger(input.headerRowIndex) ||
      input.headerRowIndex < 1 ||
      mapping.columnIndex < 0
    )
      throw new Error('Invalid payment-method column mapping');
    const token = await this.deps.tokenService.getValidAccessToken({
      userId: input.userId,
      provider: input.provider,
      ...(input.provider === 'google'
        ? { requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'] }
        : {}),
    });
    const values = await this.deps.spreadsheetPortFactory
      .create(token.accessToken)
      .getUniqueValues(
        input.fileId,
        mapping.columnIndex,
        input.sheetName,
        input.headerRowIndex + 1,
      );
    const unique = new Map<string, string>();
    for (const value of values) {
      const name = value.trim();
      const key = normalizePaymentMethodName(name);
      if (key && !unique.has(key)) unique.set(key, name);
    }
    return { names: [...unique.values()], columnMapped: true };
  }
}
