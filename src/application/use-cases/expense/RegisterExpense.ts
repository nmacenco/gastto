// LAYER: Application
// Use case: register an expense from a natural language message.
// Orchestrates: LLMPort → deterministic fallback → category → summary → (confirmation in next turn).
// Executed by BullMQ worker, NOT by Fastify handler (ADR-005).

import type { LLMPort, UserContext, SpreadsheetPort } from '../../../domain/ports/services';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  IUserCategoryRepository,
  IOperationLogRepository,
  IConversationStateRepository,
} from '../../../domain/ports/repositories';
import type { IUserProfilePort } from '../../../domain/ports/IUserProfilePort';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { ColumnMapping } from '../../../domain/entities/SpreadsheetConfig';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import { ExtractAmountCurrency } from '../../services/ExtractAmountCurrency';
import {
  isSuccessAmountCurrencyResult,
  isAmountNotFoundResult,
  isInvalidAmountFormatResult,
  isCurrencyNotFoundResult,
  isAmbiguousCurrencyResult,
} from '../../../domain/value-objects/AmountCurrencyExtractionResult';
import {
  ExpenseClarificationState,
  type MissingClarificationField,
} from '../../../domain/value-objects/expense-clarification-state';
import type { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';

export interface RegisterExpenseInput {
  userId: string;
  rawMessage: string;
  channel: 'telegram' | 'whatsapp';
}

export class RegisterExpenseUseCase {
  private readonly fallbackExtractor = new ExtractAmountCurrency();

  constructor(
    private readonly llm: LLMPort,
    private readonly spreadsheetPort: SpreadsheetPort,
    private readonly expenseRepo: IExpenseRecordRepository,
    private readonly spreadsheetConfigRepo: ISpreadsheetConfigRepository,
    private readonly columnMappingRepo: IColumnMappingRepository,
    private readonly categoryRepo: IUserCategoryRepository,
    private readonly conversationRepo: IConversationStateRepository,
    private readonly logRepo: IOperationLogRepository,
    private readonly userProfilePort: IUserProfilePort,
    private readonly classifier: ICategoryClassifier,
    private readonly reviewTimeoutMinutes: number = 10,
  ) {}

  // Fase 1: interpreta el mensaje y transiciona a EXPENSE_REVIEW
  async interpret(
    input: RegisterExpenseInput,
  ): Promise<
    | { status: 'needs_clarification'; missingField: 'monto' | 'moneda' }
    | { status: 'needs_zero_confirmation'; payload: ExpenseReviewPayload }
    | { status: 'ready_for_review'; payload: ExpenseReviewPayload }
  > {
    // Fetch user's default currency through the dedicated domain port
    const defaultCurrency = await this.userProfilePort.getDefaultCurrency(input.userId);

    // Load active user categories to give context to the LLM
    const config = await this.spreadsheetConfigRepo.findByUserId(input.userId);
    const categories = config
      ? (await this.categoryRepo.findActiveBySpreadsheetId(config.id)).map((c) => c.normalizedValue)
      : [];

    const userContext: UserContext = {
      defaultCurrency,
      categories,
      channel: input.channel,
    };

    // Calls the LLM (OpenAIAdapter or ClaudeAdapter based on configuration)
    const extracted = await this.llm.extractExpense(input.rawMessage, userContext);

    // Deterministic fallback when LLM misses amount or currency (E1-US-03)
    let resolvedExtracted = extracted;
    if (extracted.monto === null || extracted.moneda === null) {
      const fallbackResult = this.fallbackExtractor.execute(input.rawMessage, defaultCurrency);

      if (isSuccessAmountCurrencyResult(fallbackResult)) {
        resolvedExtracted = {
          ...extracted,
          monto: fallbackResult.money.amount,
          moneda: fallbackResult.money.currency,
        };
      } else if (
        isAmountNotFoundResult(fallbackResult) ||
        isInvalidAmountFormatResult(fallbackResult)
      ) {
        await this.transitionToClarifying(input.userId, 'monto', extracted, input.rawMessage);
        return { status: 'needs_clarification', missingField: 'monto' };
      } else if (
        isCurrencyNotFoundResult(fallbackResult) ||
        isAmbiguousCurrencyResult(fallbackResult)
      ) {
        await this.transitionToClarifying(input.userId, 'moneda', extracted, input.rawMessage);
        return { status: 'needs_clarification', missingField: 'moneda' };
      }
    }

    // Clarification priority: amount > currency > category (E1-US-05).
    // Category ambiguity is not clarified here; it is shown as editable in EXPENSE_REVIEW.
    if (resolvedExtracted.monto === null) {
      await this.transitionToClarifying(input.userId, 'monto', extracted, input.rawMessage);
      return { status: 'needs_clarification', missingField: 'monto' };
    }

    const moneda = resolvedExtracted.moneda ?? defaultCurrency;
    if (!moneda) {
      await this.transitionToClarifying(input.userId, 'moneda', extracted, input.rawMessage);
      return { status: 'needs_clarification', missingField: 'moneda' };
    }

    const finalExtracted = { ...resolvedExtracted, moneda };

    // Resolve category through the keyword classifier (E1-US-04)
    const classification = await this.classifier.execute({
      userId: input.userId,
      rawMessage: input.rawMessage,
      llmCategory: finalExtracted.categoriaRaw,
      llmConfidence: finalExtracted.confianzaCategoria,
    });
    const { resolvedCategory, categoryStatus } = this.toReviewCategory(classification);

    // Zero-amount confirmation path (E1-US-03)
    if (finalExtracted.monto === 0) {
      const payload = this.buildReviewPayload(
        finalExtracted,
        input.rawMessage,
        resolvedCategory,
        categoryStatus,
      );
      await this.conversationRepo.transition(
        input.userId,
        'EXPENSE_REVIEW',
        { ...payload, awaitingZeroConfirmation: true, reminderSent: false },
        new Date(Date.now() + this.reviewTimeoutMinutes * 60 * 1000),
      );
      return { status: 'needs_zero_confirmation', payload };
    }

    // Resolve date: today if LLM didn't detect any
    const resolvedDate = finalExtracted.fechaRaw
      ? new Date(finalExtracted.fechaRaw).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    const payload: ExpenseReviewPayload = {
      extracted: finalExtracted,
      rawMessage: input.rawMessage,
      resolvedDate,
      resolvedCategory,
      resolvedCategoryId: null,
      categoryStatus,
    };

    // Transiciona a EXPENSE_REVIEW con TTL de 10 min (E1-US-06)
    await this.conversationRepo.transition(
      input.userId,
      'EXPENSE_REVIEW',
      { ...payload, reminderSent: false },
      new Date(Date.now() + this.reviewTimeoutMinutes * 60 * 1000),
    );

    return { status: 'ready_for_review', payload };
  }

  // Phase 2: saves the expense once the user confirmed (ADR-006)
  async save(
    userId: string,
    payload: ExpenseReviewPayload,
    spreadsheetId: string,
  ): Promise<{ sheetName: string; rowIndex: number }> {
    const _spreadsheetId = spreadsheetId; // TODO: use when implementing multi-spreadsheet support
    const config = await this.spreadsheetConfigRepo.findByUserId(userId);
    if (!config) throw new Error('SpreadsheetConfig not found for user');

    const mappings = await this.columnMappingRepo.findBySpreadsheetId(config.id);
    const row = this.buildRow(payload, mappings);

    // appendRow devuelve la referencia de fila (ADR-006)
    const result = await this.spreadsheetPort.appendRow(config.fileId, config.sheetName, row);

    // Persists internally for auditing and for E1-US-11 (undo)
    await this.expenseRepo.create({
      userId,
      spreadsheetId: config.id,
      concepto: payload.extracted.categoriaRaw ?? payload.rawMessage.slice(0, 100),
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

    await this.logRepo.create(userId, 'EXPENSE_SAVED', {
      sheet: result.sheet,
      row: result.row,
    });

    await this.conversationRepo.transition(userId, 'IDLE', null, null);

    return { sheetName: result.sheet, rowIndex: result.row };
  }

  private buildReviewPayload(
    extracted: ExtractedExpense,
    rawMessage: string,
    resolvedCategory: string | null,
    categoryStatus: ExpenseReviewPayload['categoryStatus'],
  ): ExpenseReviewPayload {
    const resolvedDate = extracted.fechaRaw
      ? new Date(extracted.fechaRaw).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);

    return {
      extracted,
      rawMessage,
      resolvedDate,
      resolvedCategory,
      resolvedCategoryId: null,
      categoryStatus,
      reminderSent: false,
    };
  }

  private toReviewCategory(classification: ClassificationResult): {
    resolvedCategory: string | null;
    categoryStatus: ExpenseReviewPayload['categoryStatus'];
  } {
    switch (classification.kind) {
      case 'high-confidence':
        return { resolvedCategory: classification.category, categoryStatus: 'confirmed' };
      case 'ambiguous':
        return { resolvedCategory: classification.category, categoryStatus: 'ambiguous' };
      case 'fallback':
        return { resolvedCategory: classification.category, categoryStatus: 'fallback' };
      case 'no-match':
      default:
        return { resolvedCategory: null, categoryStatus: 'none' };
    }
  }

  private async transitionToClarifying(
    userId: string,
    missingField: MissingClarificationField,
    partialExtracted: ExtractedExpense,
    rawMessage: string,
  ): Promise<void> {
    const state = ExpenseClarificationState.create(missingField, partialExtracted, rawMessage);
    await this.conversationRepo.transition(
      userId,
      'EXPENSE_CLARIFYING',
      state.toPayload(),
      new Date(Date.now() + 30 * 60 * 1000), // 30 min timeout
    );
  }

  private buildRow(
    payload: ExpenseReviewPayload,
    mappings: ColumnMapping[],
  ): (string | number | null)[] {
    const MAX_COLS = Math.max(...mappings.map((m) => m.columnIndex)) + 1;
    const row: (string | number | null)[] = Array<string | number | null>(MAX_COLS).fill(null);

    for (const mapping of mappings) {
      const { GasttoField, columnIndex } = mapping;
      switch (GasttoField) {
        case 'monto':
          row[columnIndex] = payload.extracted.monto;
          break;
        case 'moneda':
          row[columnIndex] = payload.extracted.moneda;
          break;
        case 'categoria':
          row[columnIndex] = payload.resolvedCategory;
          break;
        case 'fecha':
          row[columnIndex] = payload.resolvedDate;
          break;
        case 'concepto':
          row[columnIndex] = payload.rawMessage.slice(0, 200);
          break;
        case 'medio_pago':
          row[columnIndex] = payload.extracted.medioPago;
          break;
      }
    }
    return row;
  }
}
