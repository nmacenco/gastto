// LAYER: Application
// Use case: undo the last registered expense (E1-US-11, ADR-006).
// Deletes the spreadsheet row and soft deletes in expense_records.

import type { SpreadsheetPort } from "../../domain/ports/services";
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IOperationLogRepository,
} from "../../domain/ports/repositories";

export interface UndoLastExpenseOutput {
  status: "undone" | "nothing_to_undo" | "failed";
  concepto?: string;
  monto?: number;
  moneda?: string;
  errorType?: "NETWORK_ERROR" | "AUTH_ERROR" | "STRUCTURE_ERROR";
}

export class UndoLastExpenseUseCase {
  constructor(
    private readonly spreadsheetPort: SpreadsheetPort,
    private readonly expenseRepo: IExpenseRecordRepository,
    private readonly spreadsheetConfigRepo: ISpreadsheetConfigRepository,
    private readonly logRepo: IOperationLogRepository,
  ) {}

  async execute(userId: string): Promise<UndoLastExpenseOutput> {
    // 1. Retrieves the last non-deleted record
    const last = await this.expenseRepo.findLatestByUserId(userId);
    if (!last) return { status: "nothing_to_undo" };

    const config = await this.spreadsheetConfigRepo.findByUserId(userId);
    if (!config) return { status: "nothing_to_undo" };

    try {
      // 2. Elimina la fila de la planilla real
      await this.spreadsheetPort.deleteRow(
        config.fileId,
        last.sheetName,
        last.rowIndex,
      );

      // 3. Soft delete en BD (ADR-006 — nunca hard delete)
      await this.expenseRepo.softDelete(last.id);

      // 4. Auditing
      await this.logRepo.create(userId, "EXPENSE_DELETED", {
        expenseId: last.id,
        concepto: last.concepto,
        monto: last.monto,
        moneda: last.moneda,
        sheet: last.sheetName,
        row: last.rowIndex,
      });

      return {
        status: "undone",
        concepto: last.concepto,
        monto: last.monto,
        moneda: last.moneda,
      };
    } catch (error: unknown) {
      const errorType = this.classifyError(error);

      await this.logRepo.create(
        userId,
        "EXPENSE_SAVE_FAILED",
        { phase: "undo" },
        errorType,
      );

      return { status: "failed", errorType };
    }
  }

  private classifyError(
    error: unknown,
  ): "NETWORK_ERROR" | "AUTH_ERROR" | "STRUCTURE_ERROR" {
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (
        msg.includes("401") ||
        msg.includes("403") ||
        msg.includes("unauthorized")
      )
        return "AUTH_ERROR";
      if (
        msg.includes("not found") ||
        msg.includes("range") ||
        msg.includes("structure")
      )
        return "STRUCTURE_ERROR";
    }
    return "NETWORK_ERROR";
  }
}
