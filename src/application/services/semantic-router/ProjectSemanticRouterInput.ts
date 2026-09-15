// LAYER: Application. Allowlisted projection of persisted state into untrusted model input.
import { z } from 'zod';
import {
  getFinancialExecutionClaim,
  type ConversationState,
  type FsmState,
} from '../../../domain/entities/ConversationState';
import type {
  SemanticRouterContext,
  SemanticRouterInput,
} from '../../../domain/ports/SemanticRouterPort';
import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import { normalizeExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { parseExpenseSaveRetryPayload } from '../../../domain/value-objects/expense-save-retry-payload';
import { parseExpenseUndoPayload } from '../../../domain/value-objects/expense-undo-payload';
import { expenseCopies } from '../../copies/expense.copies';
import { SemanticRouterInputSchema } from './contracts';
import { allowedActionsFor, STATE_ACTION_POLICY } from './policy';

export type SemanticInputProjection =
  | { readonly status: 'supported'; readonly input: SemanticRouterInput }
  | {
      readonly status: 'unsupported';
      readonly code: 'UNSUPPORTED_STATE' | 'UNSUPPORTED_SUBSTEP' | 'INVALID_STATE_CONTEXT';
    };

const boundedIdentifier = z.string().trim().min(1).max(500);
const boundedLabel = z.string().trim().min(1).max(200);
const cloudFileSchema = z
  .object({
    id: boundedIdentifier,
    name: boundedLabel,
    mimeType: z.string().trim().min(1).max(200),
    modifiedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const sheetInfoSchema = z
  .object({ name: boundedLabel, index: z.number().int().nonnegative() })
  .strict();
const providerSchema = z.enum(['google', 'microsoft']);
const onboardingFilePayloadSchema = z
  .object({ fileList: z.array(cloudFileSchema).min(1).max(20) })
  .strict();
const onboardingSheetDefaultPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    selectedFileName: boundedLabel,
    provider: providerSchema,
    sheetList: z.array(sheetInfoSchema).min(1).max(20),
  })
  .strict();
const onboardingSheetIdkPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    sheetList: z.array(sheetInfoSchema).min(1).max(20),
    step: z.literal('idk'),
  })
  .strict();
const onboardingSheetEmptyPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    selectedFileName: boundedLabel,
    selectedSheetName: boundedLabel,
    provider: providerSchema,
    step: z.literal('empty-sheet-confirm'),
    sheetList: z.array(sheetInfoSchema).min(1).max(20).optional(),
  })
  .strict();

const emptyContext = (): SemanticRouterContext => ({
  pendingQuestion: null,
  missingFields: [],
  expense: null,
  options: [],
});

function expenseContext(input: {
  readonly amount: number | null;
  readonly currency: string | null;
  readonly date: string | null;
}): SemanticRouterContext['expense'] {
  return { ...input, concept: null };
}

export class ProjectSemanticRouterInput {
  substepFor(conversationState: ConversationState): string | null {
    const step = conversationState.statePayload?.step;
    return typeof step === 'string' && step.length > 0 ? step : null;
  }

  execute(input: {
    readonly rawMessage: string;
    readonly conversationState: ConversationState;
  }): SemanticInputProjection {
    const { conversationState } = input;
    const state = conversationState.currentState;
    const substep = this.substepFor(conversationState);
    const allowedActions = allowedActionsFor(state, substep);
    if (!allowedActions) {
      return {
        status: 'unsupported',
        code:
          Object.keys(STATE_ACTION_POLICY[state]).length === 0
            ? 'UNSUPPORTED_STATE'
            : 'UNSUPPORTED_SUBSTEP',
      };
    }
    if (
      (conversationState.expiresAt !== null &&
        conversationState.expiresAt.getTime() <= Date.now()) ||
      getFinancialExecutionClaim(conversationState.statePayload) !== null
    ) {
      return { status: 'unsupported', code: 'INVALID_STATE_CONTEXT' };
    }

    const context = this.projectContext(state, substep, conversationState);
    if (!context) return { status: 'unsupported', code: 'INVALID_STATE_CONTEXT' };

    const projected: SemanticRouterInput = {
      rawMessage: input.rawMessage,
      state,
      substep,
      allowedActions,
      context,
    };
    const parsed = SemanticRouterInputSchema.safeParse(projected);
    return parsed.success
      ? { status: 'supported', input: parsed.data }
      : { status: 'unsupported', code: 'INVALID_STATE_CONTEXT' };
  }

  private projectContext(
    state: FsmState,
    substep: string | null,
    conversationState: ConversationState,
  ): SemanticRouterContext | null {
    const payload = conversationState.statePayload;
    switch (state) {
      case 'IDLE':
      case 'EXPENSE_RECEIVING':
        return emptyContext();
      case 'EXPENSE_CLARIFYING':
        return this.projectClarification(payload);
      case 'EXPENSE_REVIEW':
        return this.projectReview(payload);
      case 'EXPENSE_SAVING_RETRY':
        return this.projectRetry(payload);
      case 'EXPENSE_UNDO_CONFIRMING':
        return this.projectUndo(payload, conversationState.expiresAt);
      case 'ONBOARDING_FILE':
        return this.projectFiles(payload);
      case 'ONBOARDING_SHEET':
        return this.projectSheets(payload, substep);
      default:
        return null;
    }
  }

  private projectClarification(payload: unknown): SemanticRouterContext | null {
    try {
      const state = ExpenseClarificationState.fromPayload(payload);
      const date = /^\d{4}-\d{2}-\d{2}$/.test(state.partialExtracted.fechaRaw ?? '')
        ? state.partialExtracted.fechaRaw
        : null;
      return {
        pendingQuestion:
          state.missingField === 'monto'
            ? expenseCopies.clarificationAmount()
            : expenseCopies.clarificationCurrency(),
        missingFields: [state.missingField],
        expense: expenseContext({
          amount: state.partialExtracted.monto,
          currency: state.partialExtracted.moneda,
          date,
        }),
        options: [],
      };
    } catch {
      return null;
    }
  }

  private projectReview(payload: unknown): SemanticRouterContext | null {
    try {
      const review = normalizeExpenseReviewPayload(payload);
      if (!review.reviewBinding?.presentedAt) return null;
      return {
        ...emptyContext(),
        expense: expenseContext({
          amount: review.extracted.monto,
          currency: review.extracted.moneda,
          date: review.resolvedDate,
        }),
      };
    } catch {
      return null;
    }
  }

  private projectRetry(payload: unknown): SemanticRouterContext | null {
    const retry = parseExpenseSaveRetryPayload(payload);
    if (!retry?.actionBinding?.presentedAt) return null;
    return {
      ...emptyContext(),
      expense: expenseContext({
        amount: retry.expense.extracted.monto,
        currency: retry.expense.extracted.moneda,
        date: retry.expense.resolvedDate,
      }),
    };
  }

  private projectUndo(payload: unknown, expiresAt: Date | null): SemanticRouterContext | null {
    const undo = parseExpenseUndoPayload(payload);
    return undo?.actionBinding?.presentedAt && expiresAt !== null ? emptyContext() : null;
  }

  private projectFiles(payload: unknown): SemanticRouterContext | null {
    const parsed = onboardingFilePayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return {
      ...emptyContext(),
      pendingQuestion: '¿Qué opción eliges?',
      options: parsed.data.fileList.map((file, index) => ({
        position: index + 1,
        label: file.name,
      })),
    };
  }

  private projectSheets(payload: unknown, substep: string | null): SemanticRouterContext | null {
    const parsed =
      substep === 'idk'
        ? onboardingSheetIdkPayloadSchema.safeParse(payload)
        : substep === 'empty-sheet-confirm'
          ? onboardingSheetEmptyPayloadSchema.safeParse(payload)
          : onboardingSheetDefaultPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    const sheets = parsed.data.sheetList ?? [];
    return {
      ...emptyContext(),
      pendingQuestion: '¿Qué opción eliges?',
      options: sheets.map((sheet, index) => ({ position: index + 1, label: sheet.name })),
    };
  }
}
