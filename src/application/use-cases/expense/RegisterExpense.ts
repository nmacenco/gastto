// LAYER: Application
// Use case: register an expense from a natural language message.
// Orchestrates: LLMPort → category → summary → (confirmation in next turn).
// Executed by BullMQ worker, NOT by Fastify handler (ADR-005).

import type {
  LLMPort,
  UserContext,
  SpreadsheetPort,
} from "../../domain/ports/services";
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  IUserCategoryRepository,
  IOperationLogRepository,
  IConversationStateRepository,
} from "../../domain/ports/repositories";
import type { ExtractedExpense } from "../../domain/entities/ExpenseRecord";
import type { Currency } from "../../domain/entities/User";

export interface RegisterExpenseInput {
  userId: string;
  rawMessage: string;
  channel: "telegram" | "whatsapp";
  defaultCurrency: Currency | null;
}

// Lo que se pone en state_payload cuando el estado es EXPENSE_REVIEW
export interface ExpenseReviewPayload {
  extracted: ExtractedExpense;
  rawMessage: string;
  resolvedDate: string; // ISO date string
  resolvedCategory: string | null;
  resolvedCategoryId: string | null;
}

export class RegisterExpenseUseCase {
  constructor(
    private readonly llm: LLMPort,
    private readonly spreadsheetPort: SpreadsheetPort,
    private readonly expenseRepo: IExpenseRecordRepository,
    private readonly spreadsheetConfigRepo: ISpreadsheetConfigRepository,
    private readonly columnMappingRepo: IColumnMappingRepository,
    private readonly categoryRepo: IUserCategoryRepository,
    private readonly conversationRepo: IConversationStateRepository,
    private readonly logRepo: IOperationLogRepository,
  ) {}

  // Fase 1: interpreta el mensaje y transiciona a EXPENSE_REVIEW
  async interpret(
    input: RegisterExpenseInput,
  ): Promise<
    | { status: "needs_clarification"; missingField: "monto" | "moneda" }
    | { status: "ready_for_review"; payload: ExpenseReviewPayload }
  > {
    // Load active user categories to give context to the LLM
    const config = await this.spreadsheetConfigRepo.findByUserId(input.userId);
    const categories = config
      ? (await this.categoryRepo.findActiveBySpreadsheetId(config.id)).map(
          (c) => c.normalizedValue,
        )
      : [];

    const userContext: UserContext = {
      defaultCurrency: input.defaultCurrency,
      categories,
      channel: input.channel,
    };

    // Calls the LLM (OpenAIAdapter or ClaudeAdapter based on configuration)
    const extracted = await this.llm.extractExpense(
      input.rawMessage,
      userContext,
    );

    // Most blocking data first: amount > currency (E1-US-05)
    if (extracted.monto === null) {
      await this.conversationRepo.transition(
        input.userId,
        "EXPENSE_CLARIFYING",
        {
          missingField: "monto",
          partialExtracted: extracted,
          rawMessage: input.rawMessage,
        },
        new Date(Date.now() + 30 * 60 * 1000), // 30 min timeout
      );
      return { status: "needs_clarification", missingField: "monto" };
    }

    const moneda = extracted.moneda ?? input.defaultCurrency;
    if (!moneda) {
      await this.conversationRepo.transition(
        input.userId,
        "EXPENSE_CLARIFYING",
        {
          missingField: "moneda",
          partialExtracted: extracted,
          rawMessage: input.rawMessage,
        },
        new Date(Date.now() + 30 * 60 * 1000),
      );
      return { status: "needs_clarification", missingField: "moneda" };
    }

    // Resolve date: today if LLM didn't detect any
    const resolvedDate = extracted.fechaRaw
      ? new Date(extracted.fechaRaw).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    // Normalize category against the user's actual vocabulary
    const resolvedCategory = this.resolveCategory(
      extracted.categoriaRaw,
      categories,
    );

    const payload: ExpenseReviewPayload = {
      extracted: { ...extracted, moneda },
      rawMessage: input.rawMessage,
      resolvedDate,
      resolvedCategory,
      resolvedCategoryId: null,
    };

    // Transiciona a EXPENSE_REVIEW con TTL de 10 min (E1-US-06)
    await this.conversationRepo.transition(
      input.userId,
      "EXPENSE_REVIEW",
      payload,
      new Date(Date.now() + 10 * 60 * 1000),
    );

    return { status: "ready_for_review", payload };
  }

  // Phase 2: saves the expense once the user confirmed (ADR-006)
  async save(
    userId: string,
    payload: ExpenseReviewPayload,
    spreadsheetId: string,
  ): Promise<{ sheetName: string; rowIndex: number }> {
    const config = await this.spreadsheetConfigRepo.findByUserId(userId);
    if (!config) throw new Error("SpreadsheetConfig not found for user");

    const mappings = await this.columnMappingRepo.findBySpreadsheetId(
      config.id,
    );
    const row = this.buildRow(payload, mappings);

    // appendRow devuelve la referencia de fila (ADR-006)
    const result = await this.spreadsheetPort.appendRow(
      config.fileId,
      config.sheetName,
      row,
    );

    // Persists internally for auditing and for E1-US-11 (undo)
    await this.expenseRepo.create({
      userId,
      spreadsheetId: config.id,
      concepto:
        payload.extracted.categoriaRaw ?? payload.rawMessage.slice(0, 100),
      monto: payload.extracted.monto!,
      moneda: payload.extracted.moneda!,
      categoria: payload.resolvedCategory,
      fechaGasto: new Date(payload.resolvedDate),
      medioPago: payload.extracted.medioPago,
      sheetName: result.sheet,
      rowIndex: result.row,
      categoriaConfidence: payload.extracted.confianzaCategoria,
      rawMessage: payload.rawMessage,
      isDeleted: false,
      deletedAt: null,
    });

    await this.logRepo.create(userId, "EXPENSE_SAVED", {
      sheet: result.sheet,
      row: result.row,
    });

    await this.conversationRepo.transition(userId, "IDLE", null, null);

    return { sheetName: result.sheet, rowIndex: result.row };
  }

  private resolveCategory(
    raw: string | null,
    availableCategories: string[],
  ): string | null {
    if (!raw || availableCategories.length === 0) return null;
    const normalized = raw.toLowerCase().trim();
    return (
      availableCategories.find(
        (c) =>
          c.toLowerCase() === normalized ||
          normalized.includes(c.toLowerCase()),
      ) ?? null
    );
  }

  private buildRow(
    payload: ExpenseReviewPayload,
    mappings: import("../../domain/entities/SpreadsheetConfig").ColumnMapping[],
  ): (string | number | null)[] {
    const MAX_COLS = Math.max(...mappings.map((m) => m.columnIndex)) + 1;
    const row: (string | number | null)[] = Array(MAX_COLS).fill(null);

    for (const mapping of mappings) {
      const { GasttoField, columnIndex } = mapping;
      switch (GasttoField) {
        case "monto":
          row[columnIndex] = payload.extracted.monto;
          break;
        case "moneda":
          row[columnIndex] = payload.extracted.moneda;
          break;
        case "categoria":
          row[columnIndex] = payload.resolvedCategory;
          break;
        case "fecha":
          row[columnIndex] = payload.resolvedDate;
          break;
        case "concepto":
          row[columnIndex] = payload.rawMessage.slice(0, 200);
          break;
        case "medio_pago":
          row[columnIndex] = payload.extracted.medioPago;
          break;
      }
    }
    return row;
  }
}
