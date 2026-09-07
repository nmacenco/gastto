// LAYER: Infrastructure / Tests
// Contract tests for TelegramExpenseSummaryPresenter.
// Mocks both plain-text and inline-keyboard messaging ports so no real
// Telegram calls are made. Verifies the summary format and button layout.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TelegramExpenseSummaryPresenter } from './TelegramExpenseSummaryPresenter';
import type { ExpenseSummary } from '../../../application/dtos/expense-summary.dto';
import type { MessagingOutputPort } from '../../../application/ports/output/messaging.port';
import type { InlineKeyboardOutputPort } from '../../../application/ports/output/inline-keyboard.port';

function buildSummary(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    concept: 'Café con leche 100 EUR',
    amount: 100,
    currency: 'EUR',
    category: 'Comida',
    subcategory: '',
    date: '2026-07-25',
    categoryConfidence: 'alta',
    categoryStatus: 'confirmed',
    subcategoryConfidence: 'nula',
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    actions: { confirm: true, correct: true, cancel: true },
    isHighAmount: false,
    requiresExplicitConfirmation: false,
    ...overrides,
  };
}

function buildMockMessaging(): {
  sendMessage: ReturnType<typeof vi.fn<MessagingOutputPort['sendMessage']>>;
} {
  return {
    sendMessage: vi
      .fn<MessagingOutputPort['sendMessage']>()
      .mockResolvedValue({ status: 'success' }),
  };
}

function buildMockInlineKeyboard(): {
  sendMessageWithInlineKeyboard: ReturnType<
    typeof vi.fn<InlineKeyboardOutputPort['sendMessageWithInlineKeyboard']>
  >;
} {
  return {
    sendMessageWithInlineKeyboard: vi
      .fn<InlineKeyboardOutputPort['sendMessageWithInlineKeyboard']>()
      .mockResolvedValue({ status: 'success' }),
  };
}

describe('TelegramExpenseSummaryPresenter', () => {
  let messaging: ReturnType<typeof buildMockMessaging>;
  let inlineKeyboard: ReturnType<typeof buildMockInlineKeyboard>;
  let presenter: TelegramExpenseSummaryPresenter;

  beforeEach(() => {
    messaging = buildMockMessaging();
    inlineKeyboard = buildMockInlineKeyboard();
    presenter = new TelegramExpenseSummaryPresenter(messaging, inlineKeyboard, '123456789');
  });

  it('presents the summary with all five fields and inline buttons', async () => {
    await presenter.presentSummary(buildSummary());

    expect(inlineKeyboard.sendMessageWithInlineKeyboard).toHaveBeenCalledTimes(1);
    const [chatId, text, buttons] = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]!;
    expect(chatId).toBe('123456789');
    expect(text).toContain('Resumen del gasto');
    expect(text).toContain('Café con leche 100 EUR');
    expect(text).toContain('100 EUR');
    expect(text).toContain('Comida');
    expect(text).toContain('2026-07-25');

    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toEqual([
      { text: 'Confirmar', callbackData: JSON.stringify({ action: 'confirm' }) },
    ]);
    expect(buttons[1]).toEqual([
      { text: 'Corregir', callbackData: JSON.stringify({ action: 'correct' }) },
    ]);
    expect(buttons[2]).toEqual([
      { text: 'Cancelar', callbackData: JSON.stringify({ action: 'cancel' }) },
    ]);
  });

  it('marks ambiguous category with the correct marker', async () => {
    await presenter.presentSummary(buildSummary({ categoryStatus: 'ambiguous' }));

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('Comida (¿correcto?)');
  });

  it('marks fallback category with the correct marker', async () => {
    await presenter.presentSummary(buildSummary({ categoryStatus: 'fallback' }));

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('Comida (sugerida)');
  });

  it('renders a selected subcategory after its parent when hierarchy support is enabled', async () => {
    await presenter.presentSummary(
      buildSummary({
        subcategory: 'Restaurante',
        subcategoryConfidence: 'alta',
        subcategoryStatus: 'confirmed',
        subcategoryEnabled: true,
      }),
    );

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('• Categoría: Comida\n• Subcategoría: Restaurante\n• Fecha:');
  });

  it('renders an explicit empty subcategory when hierarchy support is enabled', async () => {
    await presenter.presentSummary(buildSummary({ subcategoryEnabled: true }));

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('• Subcategoría: ❓ Sin subcategoría');
  });

  it.each([
    {
      name: 'ambiguous',
      status: 'ambiguous' as const,
      confidence: 'alta' as const,
      marker: '(¿correcto?)',
    },
    {
      name: 'low-confidence confirmed',
      status: 'confirmed' as const,
      confidence: 'baja' as const,
      marker: '(¿correcto?)',
    },
    {
      name: 'fallback',
      status: 'fallback' as const,
      confidence: 'nula' as const,
      marker: '(sugerida)',
    },
  ])(
    'marks a $name subcategory independently of its parent',
    async ({ status, confidence, marker }) => {
      await presenter.presentSummary(
        buildSummary({
          categoryStatus: 'confirmed',
          categoryConfidence: 'alta',
          subcategory: 'Restaurante',
          subcategoryStatus: status,
          subcategoryConfidence: confidence,
          subcategoryEnabled: true,
        }),
      );

      const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
      expect(text).toContain(`Subcategoría: Restaurante ${marker}`);
      expect(text).toContain('Categoría: Comida\n');
    },
  );

  it('preserves the exact category-only output when hierarchy support is disabled', async () => {
    await presenter.presentSummary(buildSummary());

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toBe(
      [
        '📋 *Resumen del gasto:*',
        '• Concepto: Café con leche 100 EUR',
        '• Monto: 100 EUR',
        '• Categoría: Comida',
        '• Fecha: 2026-07-25',
        '',
        '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
      ].join('\n'),
    );
  });

  it('shows the high-amount warning and explicit confirmation prompt', async () => {
    await presenter.presentSummary(
      buildSummary({ isHighAmount: true, requiresExplicitConfirmation: true }),
    );

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('⚠️ *Monto inusualmente alto*');
    expect(text).toContain('¿Confirmamos que es correcto?');
  });

  it('labels the date as Hoy when it is today', async () => {
    await presenter.presentSummary(buildSummary({ date: 'today' }));

    const text = inlineKeyboard.sendMessageWithInlineKeyboard.mock.calls[0]![1];
    expect(text).toContain('• Fecha: Hoy');
  });

  it('sends the timeout warning via plain text', async () => {
    await presenter.showTimeoutWarning();

    expect(messaging.sendMessage).toHaveBeenCalledTimes(1);
    expect(messaging.sendMessage).toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('Confirmamos'),
    );
  });

  it('sends the cancellation notice via plain text', async () => {
    await presenter.notifyCancellation();

    expect(messaging.sendMessage).toHaveBeenCalledTimes(1);
    expect(messaging.sendMessage).toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('cancelado'),
    );
  });

  it('sends the high-amount confirmation prompt via plain text', async () => {
    await presenter.requestHighAmountConfirmation(buildSummary({ isHighAmount: true }));

    expect(messaging.sendMessage).toHaveBeenCalledTimes(1);
    const text = messaging.sendMessage.mock.calls[0]![1];
    expect(text).toContain('⚠️ *Monto inusualmente alto*');
    expect(text).toContain('Resumen del gasto');
  });
});
