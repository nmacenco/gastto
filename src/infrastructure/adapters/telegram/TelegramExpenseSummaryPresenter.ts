// LAYER: Infrastructure
// Telegram-specific presenter for the interpreted expense summary.
// Formats the channel-agnostic DTO as a Telegram markdown message and
// sends it through the messaging output port.

import type { ExpenseSummaryPresenter } from '../../../application/ports/output/expense-summary.presenter';
import type { ExpenseSummary } from '../../../application/dtos/expense-summary.dto';
import type { MessagingOutputPort } from '../../../application/ports/output/messaging.port';
import type { InlineKeyboardOutputPort } from '../../../application/ports/output/inline-keyboard.port';
import { expenseCopies } from '../../../application/copies/expense.copies';

export class TelegramExpenseSummaryPresenter implements ExpenseSummaryPresenter {
  constructor(
    private readonly messaging: MessagingOutputPort,
    private readonly inlineKeyboard: InlineKeyboardOutputPort,
    private readonly chatId: string,
  ) {}

  async presentSummary(summary: ExpenseSummary): Promise<void> {
    const text = summary.isHighAmount
      ? this.formatHighAmountSummary(summary)
      : this.formatSummary(summary);
    const buttons = this.buildActionButtons();
    await this.inlineKeyboard.sendMessageWithInlineKeyboard(this.chatId, text, buttons);
  }

  async showTimeoutWarning(pendingCount?: number): Promise<void> {
    await this.messaging.sendMessage(this.chatId, expenseCopies.reviewTimeoutWarning(pendingCount));
  }

  async notifyCancellation(): Promise<void> {
    await this.messaging.sendMessage(this.chatId, expenseCopies.reviewCancellation());
  }

  async requestHighAmountConfirmation(summary: ExpenseSummary): Promise<void> {
    const text = [
      expenseCopies.highAmountWarning(),
      '',
      this.formatSummary(summary),
      '',
      expenseCopies.highAmountConfirmationPrompt(),
    ].join('\n');
    await this.messaging.sendMessage(this.chatId, text);
  }

  private formatSummary(summary: ExpenseSummary): string {
    const categoryLabel = summary.category || '❓ Sin categoría';
    const statusMarker = this.categoryStatusMarker(summary.categoryStatus);
    const dateLabel = summary.date === 'today' ? 'Hoy' : summary.date;

    return [
      '📋 *Resumen del gasto:*',
      `• Concepto: ${summary.concept.slice(0, 80)}`,
      `• Monto: ${summary.amount} ${summary.currency}`,
      `• Categoría: ${categoryLabel}${statusMarker}`,
      `• Fecha: ${dateLabel}`,
      '',
      '¿Confirmamos? Responde *sí*, *corregir campo: valor*, o *cancelar*.',
    ].join('\n');
  }

  private formatHighAmountSummary(summary: ExpenseSummary): string {
    return [
      expenseCopies.highAmountWarning(),
      '',
      this.formatSummary(summary),
      '',
      expenseCopies.highAmountConfirmationPrompt(),
    ].join('\n');
  }

  private categoryStatusMarker(status: ExpenseSummary['categoryStatus']): string {
    if (status === 'ambiguous') return ' (¿correcto?)';
    if (status === 'fallback') return ' (sugerida)';
    return '';
  }

  private buildActionButtons() {
    return [
      [{ text: 'Confirmar', callbackData: JSON.stringify({ action: 'confirm' }) }],
      [{ text: 'Corregir', callbackData: JSON.stringify({ action: 'correct' }) }],
      [{ text: 'Cancelar', callbackData: JSON.stringify({ action: 'cancel' }) }],
    ];
  }
}
