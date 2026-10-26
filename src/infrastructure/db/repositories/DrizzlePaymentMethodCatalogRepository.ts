import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { PaymentMethodCatalog } from '../../../domain/entities/PaymentMethodCatalog';
import type { IPaymentMethodCatalogRepository } from '../../../domain/ports/PaymentMethodCatalogRepository';
import type * as schema from '../schema';
import { spreadsheetConfigs, userPaymentMethods } from '../schema';

export class DrizzlePaymentMethodCatalogRepository implements IPaymentMethodCatalogRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findBySpreadsheetId(spreadsheetId: string): Promise<PaymentMethodCatalog | null> {
    const [config] = await this.db
      .select({ confirmedAt: spreadsheetConfigs.paymentMethodsConfirmedAt })
      .from(spreadsheetConfigs)
      .where(eq(spreadsheetConfigs.id, spreadsheetId));
    if (!config?.confirmedAt) return null;
    const rows = await this.db
      .select()
      .from(userPaymentMethods)
      .where(eq(userPaymentMethods.spreadsheetId, spreadsheetId));
    return new PaymentMethodCatalog(
      spreadsheetId,
      rows.map((row) => ({
        id: row.id,
        name: row.displayName,
        normalizedName: row.normalizedName,
        isActive: row.isActive,
      })),
    );
  }
}
