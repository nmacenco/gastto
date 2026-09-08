// LAYER: Application
// Use case: correct one or more fields of an expense in review.
// Orchestrates: LLM interpretation → category resolution → high-amount guard
// → state transition back to EXPENSE_REVIEW (or cycle limit).
// Executed by the message worker, NOT by the Fastify handler.

import type { LLMPort, UserContext, CorrectionField } from '../../../domain/ports/services';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryClassifier } from '../../ports/in/categoryClassifier.port';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { MAX_CORRECTION_CYCLES } from '../../../domain/value-objects/expense-correction-state';
import type { ExpenseCorrectionState } from '../../../domain/value-objects/expense-correction-state';
import type { ExtractedExpense } from '../../../domain/entities/ExpenseRecord';
import type { Currency } from '../../../domain/entities/User';
import type { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

export interface CorrectExpenseInput {
  userId: string;
  rawMessage: string;
  state: ExpenseCorrectionState;
  channel: 'telegram' | 'whatsapp';
}

export type CorrectExpenseOutcome =
  | { status: 'not_interpretable' }
  | { status: 'new_expense' }
  | {
      status: 'invalid_subcategory';
      parentCategory: string;
      attemptedSubcategory: string;
      allowedSubcategories: string[];
    }
  | { status: 'cycle_limit'; payload: ExpenseReviewPayload }
  | { status: 'high_amount_confirmation'; payload: ExpenseReviewPayload }
  | { status: 'corrected'; payload: ExpenseReviewPayload };

export interface CorrectExpenseUseCaseDeps {
  llm: LLMPort;
  classifier: ICategoryClassifier;
  expenseRepo: IExpenseRecordRepository;
  spreadsheetConfigRepo: ISpreadsheetConfigRepository;
  categoryVocabularyRepo: ICategoryVocabularyRepository;
  transitionState: TransitionConversationState;
}

interface CorrectionSuggestionValues {
  changedFields: CorrectionField[];
  monto: number | null;
  moneda: Currency | null;
  categoriaRaw: string | null;
  subcategoriaRaw: string | null;
  fechaRaw: string | null;
}

interface CorrectionHierarchyContext {
  spreadsheetId: string | null;
  vocabulary: CategoryVocabulary | null;
}

type ApplySuggestionOutcome =
  | { status: 'applied'; payload: ExpenseReviewPayload }
  | Extract<CorrectExpenseOutcome, { status: 'invalid_subcategory' }>;

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

    const hierarchy = await this.loadHierarchy(userId);
    const suggestion = await this.deps.llm.interpretCorrection(
      rawMessage,
      state.payload.extracted,
      this.buildUserContext(input, hierarchy.vocabulary),
    );

    if (suggestion.intent === 'new_expense') {
      return { status: 'new_expense' };
    }

    if (suggestion.intent === 'unrelated' || suggestion.changedFields.length === 0) {
      return { status: 'not_interpretable' };
    }

    if (suggestion.changedFields.includes('subcategoria') && suggestion.subcategoriaRaw === null) {
      return { status: 'not_interpretable' };
    }

    const applied = await this.applySuggestion(input, state.payload, suggestion, hierarchy);
    if (applied.status === 'invalid_subcategory') return applied;
    const updatedPayload = applied.payload;

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

  private async loadHierarchy(userId: string): Promise<CorrectionHierarchyContext> {
    const config = await this.deps.spreadsheetConfigRepo.findByUserId(userId);
    return {
      spreadsheetId: config?.id ?? null,
      vocabulary: config
        ? await this.deps.categoryVocabularyRepo.findBySpreadsheetId(config.id)
        : null,
    };
  }

  private buildUserContext(
    input: CorrectExpenseInput,
    vocabulary: CategoryVocabulary | null,
  ): UserContext {
    const categories = vocabulary?.getCategories() ?? [];

    return {
      defaultCurrency: input.state.payload.extracted.moneda,
      categories: categories.map((category) => category.name),
      categoryHierarchy: categories.map((category) => ({
        name: category.name,
        subcategories: vocabulary
          ? vocabulary.getSubcategories(category.id).map((subcategory) => subcategory.name)
          : [],
      })),
      subcategoryEnabled: input.state.payload.subcategoryEnabled === true,
      channel: input.channel,
    };
  }

  private async applySuggestion(
    input: CorrectExpenseInput,
    current: ExpenseReviewPayload,
    suggestion: CorrectionSuggestionValues,
    hierarchy: CorrectionHierarchyContext,
  ): Promise<ApplySuggestionOutcome> {
    let extracted: ExtractedExpense = { ...current.extracted };
    let resolvedCategory = current.resolvedCategory;
    let resolvedCategoryId = current.resolvedCategoryId;
    let categoryStatus = current.categoryStatus;
    let resolvedSubcategory = current.resolvedSubcategory;
    let resolvedSubcategoryId = current.resolvedSubcategoryId;
    let subcategoryStatus = current.subcategoryStatus;
    const dateWasCorrected = suggestion.changedFields.includes('fecha');
    const categoryWasCorrected = suggestion.changedFields.includes('categoria');
    const subcategoryWasCorrected = suggestion.changedFields.includes('subcategoria');

    if (categoryWasCorrected || subcategoryWasCorrected) {
      const attemptedSubcategory = suggestion.subcategoriaRaw;
      const currentParent = hierarchy.vocabulary
        ?.getCategories()
        .find((category) => category.id === current.resolvedCategoryId);

      if (subcategoryWasCorrected && current.subcategoryEnabled !== true) {
        return this.invalidSubcategory(
          current.resolvedCategory ?? suggestion.categoriaRaw ?? 'Sin categoría',
          attemptedSubcategory!,
          [],
        );
      }

      if (subcategoryWasCorrected && !categoryWasCorrected && !currentParent) {
        return this.invalidSubcategory(
          current.resolvedCategory ?? 'Sin categoría',
          attemptedSubcategory!,
          [],
        );
      }

      const classification = await this.deps.classifier.execute({
        userId: input.userId,
        spreadsheetId: hierarchy.spreadsheetId,
        rawMessage: input.rawMessage,
        llmCategory: categoryWasCorrected ? suggestion.categoriaRaw : currentParent!.name,
        llmConfidence: 'alta',
        llmSubcategory: subcategoryWasCorrected ? attemptedSubcategory : null,
        llmSubcategoryConfidence: subcategoryWasCorrected ? 'alta' : 'nula',
      });

      const selectedParentId = classification.category.id;
      const selectedParentName = classification.category.name;
      const allowedSubcategories =
        selectedParentId === null || hierarchy.vocabulary === null
          ? []
          : hierarchy.vocabulary
              .getSubcategories(selectedParentId)
              .map((subcategory) => subcategory.name);

      if (
        subcategoryWasCorrected &&
        (selectedParentId === null ||
          selectedParentName === null ||
          classification.subcategory.id === null ||
          classification.subcategory.name === null ||
          classification.subcategory.categoryId !== selectedParentId)
      ) {
        return this.invalidSubcategory(
          selectedParentName ??
            suggestion.categoriaRaw ??
            current.resolvedCategory ??
            'Sin categoría',
          attemptedSubcategory!,
          allowedSubcategories,
        );
      }

      resolvedCategory = selectedParentName;
      resolvedCategoryId = selectedParentId;
      categoryStatus = classification.category.status;
      if (categoryWasCorrected && suggestion.categoriaRaw !== null) {
        extracted = { ...extracted, categoriaRaw: suggestion.categoriaRaw };
      }

      if (subcategoryWasCorrected) {
        resolvedSubcategory = classification.subcategory.name;
        resolvedSubcategoryId = classification.subcategory.id;
        subcategoryStatus = classification.subcategory.status;
        extracted = {
          ...extracted,
          subcategoriaRaw: attemptedSubcategory,
          confianzaSubcategoria: classification.subcategory.confidence,
        };
      } else if (categoryWasCorrected) {
        const preservedChild =
          selectedParentId === null
            ? undefined
            : hierarchy.vocabulary
                ?.getSubcategories(selectedParentId)
                .find((subcategory) => subcategory.id === current.resolvedSubcategoryId);
        if (!preservedChild || preservedChild.categoryId !== selectedParentId) {
          resolvedSubcategory = null;
          resolvedSubcategoryId = null;
          subcategoryStatus = 'none';
          extracted = {
            ...extracted,
            subcategoriaRaw: null,
            confianzaSubcategoria: 'nula',
          };
        }
      }
    }

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
        case 'subcategoria':
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
      status: 'applied',
      payload: {
        ...current,
        extracted,
        resolvedDate,
        resolvedCategory,
        resolvedCategoryId,
        categoryStatus,
        ...(resolvedSubcategory === undefined ? {} : { resolvedSubcategory }),
        ...(resolvedSubcategoryId === undefined ? {} : { resolvedSubcategoryId }),
        ...(subcategoryStatus === undefined ? {} : { subcategoryStatus }),
      },
    };
  }

  private invalidSubcategory(
    parentCategory: string,
    attemptedSubcategory: string,
    allowedSubcategories: string[],
  ): Extract<CorrectExpenseOutcome, { status: 'invalid_subcategory' }> {
    return {
      status: 'invalid_subcategory',
      parentCategory,
      attemptedSubcategory,
      allowedSubcategories,
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
}
