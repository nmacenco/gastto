// LAYER: Application
// Use case: correct one or more fields of an expense in review.
// Orchestrates: LLM interpretation → category resolution → high-amount guard
// → state transition back to EXPENSE_REVIEW (or cycle limit).
// Executed by the message worker, NOT by the Fastify handler.

import type { LLMPort, UserContext, CorrectionField } from '../../../domain/ports/services';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IUserCategoryRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { MAX_CORRECTION_CYCLES } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { Currency } from '../../../domain/entities/User';
import type { ClassificationResult } from '../../../domain/value-objects/ClassificationResult';

export interface CorrectExpenseInput {
  userId: string;
  rawMessage: string;
  state: ExpenseCorrectionState;
  channel: 'telegram' | 'whatsapp';
}

export type CorrectExpenseOutcome =
  | { status: 'not_interpretable' }
  | { status: 'cycle_limit'; payload: ExpenseReviewPayload }
  | { status: 'high_amount_confirmation'; payload: ExpenseReviewPayload }
  | { status: 'corrected'; payload: ExpenseReviewPayload };

export interface CorrectExpenseUseCaseDeps {
  llm: LLMPort;
  classifier: ICategoryClassifier;
  expenseRepo: IExpenseRecordRepository;
  spreadsheetConfigRepo: ISpreadsheetConfigRepository;
  categoryRepo: IUserCategoryRepository;
  transitionState: TransitionConversationState;
}

interface CorrectionSuggestionValues {
  changedFields: CorrectionField[];
  monto: number | null;
  moneda: Currency | null;
  categoriaRaw: string | null;
  fechaRaw: string | null;
}

export class CorrectExpenseUseCase {
  private readonly reviewTimeoutMinutes: number;

  constructor(
    private readonly deps: CorrectExpenseUseCaseDeps,
    reviewTimeoutMinutes: number = 10,
  ) {
    this.reviewTimeoutMinutes = reviewTimeoutMinutes;
  }

  async execute(input: CorrectExpenseInput): Promise<CorrectExpenseOutcome> {
    const { userId, rawMessage, state } = input;

    const suggestion = await this.deps.llm.interpretCorrection(
      rawMessage,
      state.payload.extracted,
      await this.buildUserContext(input),
    );

    if (!suggestion.interpretable || suggestion.changedFields.length === 0) {
      return { status: 'not_interpretable' };
    }

    const updatedPayload = await this.applySuggestion(input, state.payload, suggestion);

    const nextState = state.next(updatedPayload);

    if (nextState.correctionCycles > MAX_CORRECTION_CYCLES) {
      await this.deps.transitionState.execute({
        userId,
        targetState: 'EXPENSE_CORRECTING',
        payload: nextState.toPayload(),
        expiresAt: this.reviewExpiration(),
      });

      return { status: 'cycle_limit', payload: updatedPayload };
    }

    const isHighAmount = await this.isHighAmount(userId, updatedPayload);
    const payloadForReview: ExpenseReviewPayload = {
      ...updatedPayload,
      pendingHighAmountConfirmation: isHighAmount,
    };

    await this.deps.transitionState.execute({
      userId,
      targetState: 'EXPENSE_REVIEW',
      payload: payloadForReview as unknown as Record<string, unknown>,
      expiresAt: this.reviewExpiration(),
    });

    return isHighAmount
      ? { status: 'high_amount_confirmation', payload: payloadForReview }
      : { status: 'corrected', payload: payloadForReview };
  }

  private async buildUserContext(input: CorrectExpenseInput): Promise<UserContext> {
    const config = await this.deps.spreadsheetConfigRepo.findByUserId(input.userId);
    const categories = config
      ? (await this.deps.categoryRepo.findActiveBySpreadsheetId(config.id)).map(
          (c) => c.normalizedValue,
        )
      : [];

    return {
      defaultCurrency: input.state.payload.extracted.moneda,
      categories,
      channel: input.channel,
    };
  }

  private async applySuggestion(
    input: CorrectExpenseInput,
    current: ExpenseReviewPayload,
    suggestion: CorrectionSuggestionValues,
  ): Promise<ExpenseReviewPayload> {
    let extracted: ExtractedExpense = { ...current.extracted };
    let resolvedCategory = current.resolvedCategory;
    let resolvedCategoryId = current.resolvedCategoryId;
    let categoryStatus = current.categoryStatus;
    const dateWasCorrected = suggestion.changedFields.includes('fecha');

    for (const field of suggestion.changedFields) {
      switch (field) {
        case 'monto':
          if (suggestion.monto !== null) {
            extracted = { ...extracted, monto: suggestion.monto };
          }
          break;
        case 'moneda':
          if (suggestion.moneda !== null) {
            extracted = { ...extracted, moneda: suggestion.moneda };
          }
          break;
        case 'categoria':
          if (suggestion.categoriaRaw !== null) {
            const classification = await this.deps.classifier.execute({
              userId: input.userId,
              rawMessage: input.rawMessage,
              llmCategory: suggestion.categoriaRaw,
              llmConfidence: 'alta',
            });
            const category = this.toReviewCategory(classification);
            resolvedCategory = category.resolvedCategory;
            resolvedCategoryId = category.resolvedCategoryId;
            categoryStatus = category.categoryStatus;
            extracted = { ...extracted, categoriaRaw: suggestion.categoriaRaw };
          }
          break;
        case 'fecha':
          if (suggestion.fechaRaw !== null) {
            extracted = { ...extracted, fechaRaw: suggestion.fechaRaw };
          }
          break;
      }
    }

    const resolvedDate = dateWasCorrected
      ? this.resolveDate(extracted.fechaRaw)
      : current.resolvedDate;

    return {
      ...current,
      extracted,
      resolvedDate,
      resolvedCategory,
      resolvedCategoryId,
      categoryStatus,
    };
  }

  private resolveDate(fechaRaw: string | null): string {
    const today = new Date();
    const normalized = (fechaRaw ?? '').toLowerCase().trim();

    if (normalized === 'ayer') {
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday.toISOString().slice(0, 10);
    }

    if (normalized === 'hoy') {
      return today.toISOString().slice(0, 10);
    }

    if (normalized === 'mañana') {
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().slice(0, 10);
    }

    const parsed = Date.parse(normalized);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString().slice(0, 10);
    }

    return today.toISOString().slice(0, 10);
  }

  private async isHighAmount(userId: string, payload: ExpenseReviewPayload): Promise<boolean> {
    const amount = payload.extracted.monto ?? 0;
    const average = await this.deps.expenseRepo.findAverageAmountByUserId(userId);
    if (average === null) return false;
    return amount > average * 10;
  }

  private reviewExpiration(): Date {
    return new Date(Date.now() + this.reviewTimeoutMinutes * 60 * 1000);
  }

  private toReviewCategory(classification: ClassificationResult): {
    resolvedCategory: string | null;
    resolvedCategoryId: string | null;
    categoryStatus: ExpenseReviewPayload['categoryStatus'];
  } {
    switch (classification.kind) {
      case 'high-confidence':
        return {
          resolvedCategory: classification.category,
          resolvedCategoryId: null,
          categoryStatus: 'confirmed',
        };
      case 'ambiguous':
        return {
          resolvedCategory: classification.category,
          resolvedCategoryId: null,
          categoryStatus: 'ambiguous',
        };
      case 'fallback':
        return {
          resolvedCategory: classification.category,
          resolvedCategoryId: null,
          categoryStatus: 'fallback',
        };
      case 'no-match':
      default:
        return { resolvedCategory: null, resolvedCategoryId: null, categoryStatus: 'none' };
    }
  }
}
