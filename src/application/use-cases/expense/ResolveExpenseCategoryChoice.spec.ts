import { describe, expect, it, vi } from 'vitest';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import type { ExpenseReviewPayload } from '../../../domain/value-objects/expense-review-payload';
import type { ExpenseCategoryChoiceCommit } from '../../ports/ExpenseCategoryChoiceCommit';
import type { VocabularySnapshot } from '../../ports/SettingsVocabularyCommit';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { ResolveExpenseCategoryChoice } from './ResolveExpenseCategoryChoice';

const original = (): ExpenseReviewPayload => ({
  rawMessage: 'Cafe 12 EUR',
  extracted: {
    monto: 12,
    moneda: 'EUR',
    categoriaRaw: 'Comida',
    subcategoriaRaw: null,
    fechaRaw: null,
    medioPago: null,
    confianzaCategoria: 'alta',
    confianzaSubcategoria: 'nula',
  },
  resolvedDate: '2026-11-23',
  resolvedCategory: 'Comida',
  resolvedCategoryId: '11111111-1111-4111-8111-111111111111',
  categoryStatus: 'confirmed',
  resolvedSubcategory: null,
  resolvedSubcategoryId: null,
  subcategoryStatus: 'none',
  subcategoryEnabled: false,
  reviewBinding: {
    operationId: 'abcdefghijklmnopqrstuv',
    revision: 1,
    presentedAt: '2026-11-23T10:00:00.000Z',
  },
});

function setup() {
  let observed: ConversationState = {
    userId: 'user-1',
    revision: '1',
    currentState: 'EXPENSE_REVIEW',
    statePayload: original() as unknown as Record<string, unknown>,
    enteredAt: new Date(),
    updatedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  };
  const execute = vi.fn(
    (input: {
      targetState: ConversationState['currentState'];
      payload?: Record<string, unknown>;
      expiresAt?: Date | null;
    }) => {
      observed = {
        ...observed,
        revision: String(Number(observed.revision) + 1),
        currentState: input.targetState,
        statePayload: input.payload ?? null,
        expiresAt: input.expiresAt ?? null,
        updatedAt: new Date(),
      };
      return Promise.resolve({ status: 'updated' as const, state: observed });
    },
  );
  const adoptCommittedState = vi.fn((state: ConversationState) => {
    observed = state;
  });
  const transitionState = {
    currentState: () => observed,
    execute,
    adoptCommittedState,
    precondition: (state: ConversationState, expiry: string) => ({
      revision: state.revision,
      currentState: state.currentState,
      expiry,
    }),
  } as unknown as TransitionConversationState;
  const baseline: VocabularySnapshot = {
    categories: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        name: 'Comida',
        normalizedName: 'comida',
        isActive: true,
      },
    ],
    subcategories: [],
  };
  const load = vi.fn().mockResolvedValue(baseline);
  const commitExecute = vi
    .fn<ExpenseCategoryChoiceCommit['execute']>()
    .mockImplementation(({ next }) =>
      Promise.resolve({
        status: 'updated',
        state: {
          ...observed,
          revision: String(Number(observed.revision) + 1),
          currentState: 'EXPENSE_REVIEW',
          statePayload: next as unknown as Record<string, unknown>,
        },
      }),
    );
  const flow = new ResolveExpenseCategoryChoice({
    transitionState,
    commit: { load, execute: commitExecute },
  });
  const correction = {
    status: 'unresolved_category' as const,
    attemptedName: 'Mascotas',
    suggestedName: 'Comida',
    candidates: ['Comida'],
    sourceConfigId: 'sheet-1',
    payload: { ...original(), extracted: { ...original().extracted, monto: 25 } },
    correctionCycles: 0,
  };
  return { flow, correction, execute, commitExecute, baseline, current: () => observed };
}

function childCorrection(ctx: ReturnType<typeof setup>) {
  ctx.baseline.subcategories.push({
    id: 'child-1',
    categoryId: '11111111-1111-4111-8111-111111111111',
    name: 'Restaurante',
    normalizedName: 'restaurante',
    isActive: true,
  });
  ctx.baseline.subcategories.push({
    id: 'child-other-parent',
    categoryId: 'another-parent',
    name: 'Peajes',
    normalizedName: 'peajes',
    isActive: true,
  });
  return {
    status: 'unresolved_subcategory' as const,
    attemptedName: 'Peajes',
    suggestedName: null,
    candidates: ['Restaurante'],
    parentCategoryId: '11111111-1111-4111-8111-111111111111',
    parentCategoryName: 'Comida',
    subcategoryColumnMapped: false,
    sourceConfigId: 'sheet-1',
    payload: { ...original(), extracted: { ...original().extracted, monto: 25 } },
    correctionCycles: 1,
  };
}

describe('ResolveExpenseCategoryChoice', () => {
  it('confirms a child under its parent and restores the corrected expense for review', async () => {
    const ctx = setup();
    const correction = childCorrection(ctx);
    const started = await ctx.flow.start({ userId: 'user-1', original: original(), correction });
    expect(started).toMatchObject({
      status: 'choose',
      choice: { kind: 'subcategory', parentCategoryName: 'Comida', attemptedName: 'Peajes' },
    });
    expect(ctx.commitExecute).not.toHaveBeenCalled();
    expect(
      (
        await ctx.flow.reply({
          userId: 'user-1',
          rawMessage: 'agregar',
          receivedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe('confirm');
    expect(ctx.commitExecute).not.toHaveBeenCalled();
    const result = await ctx.flow.reply({
      userId: 'user-1',
      rawMessage: 'confirmar agregar',
      receivedAt: new Date().toISOString(),
    });
    expect(result).toMatchObject({
      status: 'review',
      payload: {
        extracted: { monto: 25, subcategoriaRaw: 'Peajes' },
        resolvedCategoryId: correction.parentCategoryId,
        resolvedSubcategory: 'Peajes',
        subcategoryEnabled: true,
        reviewBinding: { revision: 2, presentedAt: null },
      },
    });
    expect(ctx.commitExecute.mock.calls[0]?.[0]).toMatchObject({
      choice: { kind: 'subcategory', parentCategoryId: correction.parentCategoryId },
      selected: { name: 'Peajes', add: true },
    });
    expect(ctx.current().currentState).toBe('EXPENSE_REVIEW');
  });

  it('selects only children of the active parent and lets the user return to the original expense', async () => {
    const ctx = setup();
    const correction = childCorrection(ctx);
    await ctx.flow.start({ userId: 'user-1', original: original(), correction });
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'elegir Peajes',
        receivedAt: new Date().toISOString(),
      }),
    ).toEqual({ status: 'invalid' });
    expect(ctx.commitExecute).not.toHaveBeenCalled();
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'elegir Restaurante',
        receivedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 'review',
      payload: { resolvedSubcategoryId: 'child-1', extracted: { monto: 25 } },
    });
    const another = setup();
    await another.flow.start({
      userId: 'user-1',
      original: original(),
      correction: childCorrection(another),
    });
    expect(
      await another.flow.reply({
        userId: 'user-1',
        rawMessage: 'volver',
        receivedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 'review',
      payload: { extracted: { monto: 12 }, resolvedSubcategoryId: null },
    });
    expect(another.commitExecute).not.toHaveBeenCalled();
  });
  it('requires a separate add confirmation and keeps the corrected amount pending', async () => {
    const ctx = setup();
    const started = await ctx.flow.start({
      userId: 'user-1',
      original: original(),
      correction: ctx.correction,
    });
    expect(started.status).toBe('choose');
    expect(ctx.commitExecute).not.toHaveBeenCalled();
    expect(
      (
        await ctx.flow.reply({
          userId: 'user-1',
          rawMessage: 'agregar',
          receivedAt: new Date().toISOString(),
        })
      ).status,
    ).toBe('confirm');
    expect(ctx.commitExecute).not.toHaveBeenCalled();
    const result = await ctx.flow.reply({
      userId: 'user-1',
      rawMessage: 'confirmar agregar',
      receivedAt: new Date().toISOString(),
    });
    expect(result).toMatchObject({
      status: 'review',
      payload: {
        extracted: { monto: 25 },
        resolvedCategory: 'Mascotas',
        reviewBinding: { revision: 2, presentedAt: null },
      },
    });
    expect(ctx.commitExecute.mock.calls[0]?.[0].selected).toMatchObject({
      name: 'Mascotas',
      add: true,
    });
    expect(ctx.current().currentState).toBe('EXPENSE_REVIEW');
  });

  it('allows choosing an existing category without adding one', async () => {
    const ctx = setup();
    await ctx.flow.start({ userId: 'user-1', original: original(), correction: ctx.correction });
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'elegir Comida',
        receivedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 'review',
      payload: { resolvedCategory: 'Comida' },
    });
    expect(ctx.commitExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        selected: { id: '11111111-1111-4111-8111-111111111111', name: 'Comida', add: false },
      }),
    );
  });

  it('accepts an explicitly confirmed suggested category without adding it', async () => {
    const ctx = setup();
    await ctx.flow.start({ userId: 'user-1', original: original(), correction: ctx.correction });
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'sí',
        receivedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 'review',
      payload: { resolvedCategory: 'Comida' },
    });
    expect(ctx.commitExecute.mock.calls[0]?.[0].selected.add).toBe(false);
  });

  it('keeps a child when the chosen existing parent still owns it', async () => {
    const ctx = setup();
    ctx.baseline.subcategories.push({
      id: 'child-1',
      categoryId: '11111111-1111-4111-8111-111111111111',
      name: 'Restaurante',
      normalizedName: 'restaurante',
      isActive: true,
    });
    const review = {
      ...original(),
      resolvedSubcategory: 'Restaurante',
      resolvedSubcategoryId: 'child-1',
      subcategoryStatus: 'confirmed' as const,
      subcategoryEnabled: true,
      extracted: {
        ...original().extracted,
        subcategoriaRaw: 'Restaurante',
        confianzaSubcategoria: 'alta' as const,
      },
    };
    await ctx.flow.start({
      userId: 'user-1',
      original: review,
      correction: { ...ctx.correction, payload: review },
    });
    const outcome = await ctx.flow.reply({
      userId: 'user-1',
      rawMessage: 'elegir Comida',
      receivedAt: new Date().toISOString(),
    });
    expect(outcome).toMatchObject({
      status: 'review',
      payload: { resolvedSubcategoryId: 'child-1', extracted: { subcategoriaRaw: 'Restaurante' } },
    });
  });

  it('returns to the original expense without creating the category', async () => {
    const ctx = setup();
    await ctx.flow.start({ userId: 'user-1', original: original(), correction: ctx.correction });
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'volver',
        receivedAt: new Date().toISOString(),
      }),
    ).toMatchObject({
      status: 'review',
      payload: { extracted: { monto: 12 }, resolvedCategory: 'Comida' },
    });
    expect(ctx.commitExecute).not.toHaveBeenCalled();
  });

  it('rejects an expired pending choice', async () => {
    const ctx = setup();
    await ctx.flow.start({ userId: 'user-1', original: original(), correction: ctx.correction });
    const state = ctx.current();
    state.expiresAt = new Date(Date.now() - 1);
    expect(
      await ctx.flow.reply({
        userId: 'user-1',
        rawMessage: 'agregar',
        receivedAt: new Date().toISOString(),
      }),
    ).toEqual({
      status: 'stale',
    });
    expect(ctx.commitExecute).not.toHaveBeenCalled();
  });

  it('rejects a reply received before the current choice was opened', async () => {
    const ctx = setup();
    await ctx.flow.start({ userId: 'user-1', original: original(), correction: ctx.correction });
    const older = new Date(ctx.current().updatedAt.getTime() - 1000).toISOString();
    expect(
      await ctx.flow.reply({ userId: 'user-1', rawMessage: 'agregar', receivedAt: older }),
    ).toEqual({ status: 'stale' });
    expect(ctx.commitExecute).not.toHaveBeenCalled();
  });
});
