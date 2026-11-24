import { randomUUID } from 'node:crypto';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import { advanceExpenseReviewBinding } from '../../../domain/value-objects/expense-review-binding';
import type { ExpenseCategoryChoiceCommit } from '../../ports/ExpenseCategoryChoiceCommit';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { CorrectExpenseOutcome } from './CorrectExpenseUseCase';
import {
  parseExpenseCategoryChoice,
  type ExpenseCategoryChoiceState,
} from './ExpenseCategoryChoiceState';

export type ExpenseCategoryChoiceOutcome =
  | { status: 'choose'; choice: ExpenseCategoryChoiceState }
  | { status: 'confirm'; choice: ExpenseCategoryChoiceState }
  | { status: 'review'; payload: ExpenseReviewPayload }
  | { status: 'stale' | 'invalid' };

function normalizeName(name: string): string {
  return name.trim().toLocaleLowerCase('es');
}

export class ResolveExpenseCategoryChoice {
  constructor(
    private readonly deps: {
      transitionState: TransitionConversationState;
      commit: ExpenseCategoryChoiceCommit;
    },
  ) {}

  async start(input: {
    userId: string;
    original: ExpenseReviewPayload;
    correction: Extract<CorrectExpenseOutcome, { status: 'unresolved_category' }>;
  }): Promise<ExpenseCategoryChoiceOutcome> {
    const observed = this.deps.transitionState.currentState(input.userId);
    if (
      !observed ||
      !['EXPENSE_REVIEW', 'EXPENSE_CORRECTING'].includes(observed.currentState) ||
      !observed.expiresAt ||
      observed.expiresAt.getTime() <= Date.now() ||
      !input.correction.attemptedName.trim() ||
      input.correction.attemptedName.length > 120
    )
      return { status: 'stale' };
    const baseline = await this.deps.commit.load(input.correction.sourceConfigId);
    const choice: ExpenseCategoryChoiceState = {
      _type: 'ExpenseCategoryChoice',
      choiceId: randomUUID(),
      stage: 'choose',
      attemptedName: input.correction.attemptedName,
      suggestedName: input.correction.suggestedName,
      sourceConfigId: input.correction.sourceConfigId,
      baseline,
      original: input.original,
      proposed: input.correction.payload,
      correctionCycles: input.correction.correctionCycles,
    };
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'EXPENSE_CORRECTING',
      payload: choice as unknown as Record<string, unknown>,
      expiresAt: observed.expiresAt,
      expected: this.deps.transitionState.precondition(observed, 'unexpired'),
    });
    return { status: 'choose', choice };
  }

  async reply(input: {
    userId: string;
    rawMessage: string;
    receivedAt: string;
  }): Promise<ExpenseCategoryChoiceOutcome> {
    const observed = this.deps.transitionState.currentState(input.userId);
    const choice = parseExpenseCategoryChoice(observed?.statePayload);
    if (
      !observed ||
      observed.currentState !== 'EXPENSE_CORRECTING' ||
      !choice ||
      !observed.expiresAt ||
      observed.expiresAt.getTime() <= Date.now()
    )
      return { status: 'stale' };
    const receivedAt = Date.parse(input.receivedAt);
    if (!Number.isFinite(receivedAt) || receivedAt < observed.updatedAt.getTime())
      return { status: 'stale' };
    const command = input.rawMessage.trim();
    if (/^volver$/iu.test(command)) {
      const review = {
        ...choice.original,
        reviewBinding: advanceExpenseReviewBinding(choice.original.reviewBinding),
      };
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_REVIEW',
        payload: review,
        expiresAt: observed.expiresAt,
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
      return { status: 'review', payload: review };
    }
    if (choice.stage === 'choose' && /^agregar$/iu.test(command)) {
      const updated: ExpenseCategoryChoiceState = { ...choice, stage: 'confirm' };
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_CORRECTING',
        payload: updated as unknown as Record<string, unknown>,
        expiresAt: observed.expiresAt,
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
      return { status: 'confirm', choice: updated };
    }
    if (choice.stage === 'confirm' && /^no$/iu.test(command)) {
      const updated: ExpenseCategoryChoiceState = { ...choice, stage: 'choose' };
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_CORRECTING',
        payload: updated as unknown as Record<string, unknown>,
        expiresAt: observed.expiresAt,
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
      return { status: 'choose', choice: updated };
    }
    let selected: { id: string; name: string; add: boolean } | null = null;
    if (choice.stage === 'confirm' && /^confirmar agregar$/iu.test(command)) {
      const existing = choice.baseline.categories.find(
        (row) => row.normalizedName === normalizeName(choice.attemptedName),
      );
      if (existing?.isActive) return { status: 'invalid' };
      selected = {
        id: existing?.id ?? randomUUID(),
        name: existing?.name ?? choice.attemptedName,
        add: true,
      };
    } else if (choice.stage === 'choose') {
      const match = command.match(/^elegir\s+(.+)$/iu);
      const named = match?.[1] ?? (/^s[ií]$/iu.test(command) ? choice.suggestedName : null);
      const existing =
        named &&
        choice.baseline.categories.find(
          (row) => row.isActive && row.normalizedName === normalizeName(named),
        );
      if (existing) selected = { id: existing.id, name: existing.name, add: false };
    }
    if (!selected) return { status: 'invalid' };
    const keepChild =
      selected.id === choice.original.resolvedCategoryId &&
      choice.baseline.subcategories.some(
        (child) =>
          child.id === choice.original.resolvedSubcategoryId &&
          child.categoryId === selected.id &&
          child.isActive,
      );
    const next: ExpenseReviewPayload = {
      ...choice.proposed,
      extracted: {
        ...choice.proposed.extracted,
        categoriaRaw: selected.name,
        subcategoriaRaw: keepChild ? choice.proposed.extracted.subcategoriaRaw : null,
        confianzaCategoria: 'alta',
        confianzaSubcategoria: keepChild ? choice.proposed.extracted.confianzaSubcategoria : 'nula',
      },
      resolvedCategory: selected.name,
      resolvedCategoryId: selected.id,
      categoryStatus: 'confirmed',
      resolvedSubcategory: keepChild ? (choice.proposed.resolvedSubcategory ?? null) : null,
      resolvedSubcategoryId: keepChild ? (choice.proposed.resolvedSubcategoryId ?? null) : null,
      subcategoryStatus: keepChild ? (choice.proposed.subcategoryStatus ?? 'none') : 'none',
      reviewBinding: advanceExpenseReviewBinding(choice.original.reviewBinding),
    };
    const result = await this.deps.commit.execute({
      userId: input.userId,
      expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      choice,
      selected,
      next,
    });
    if (result.status === 'updated') {
      this.deps.transitionState.adoptCommittedState(result.state);
      return { status: 'review', payload: next };
    }
    if (result.status === 'conflict') {
      const baseline = await this.deps.commit.load(choice.sourceConfigId);
      const refreshed: ExpenseCategoryChoiceState = { ...choice, stage: 'choose', baseline };
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'EXPENSE_CORRECTING',
        payload: refreshed as unknown as Record<string, unknown>,
        expiresAt: observed.expiresAt,
        expected: this.deps.transitionState.precondition(observed, 'unexpired'),
      });
      return { status: 'choose', choice: refreshed };
    }
    return { status: 'stale' };
  }
}
