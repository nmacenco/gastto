import type { PaymentMethodCatalog } from '../entities/PaymentMethodCatalog';

export interface IPaymentMethodCatalogRepository {
  findBySpreadsheetId(spreadsheetId: string): Promise<PaymentMethodCatalog | null>;
}
