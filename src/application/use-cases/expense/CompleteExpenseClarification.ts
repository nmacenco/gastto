// LAYER: Application. Completes one validated expense clarification turn.

import { ExpenseClarificationState } from '../../../domain/value-objects/expense-clarification-state';
import type { RegisterExpenseUseCase } from './RegisterExpense';

export interface CompleteExpenseClarificationInput {
  readonly userId: string;
  readonly rawReply: string;
  readonly channel: 'telegram' | 'whatsapp';
  readonly statePayload: unknown;
}

export type CompleteExpenseClarificationOutcome = Awaited<
  ReturnType<RegisterExpenseUseCase['interpret']>
>;

export class CompleteExpenseClarification {
  constructor(private readonly registerExpense: Pick<RegisterExpenseUseCase, 'interpret'>) {}

  async execute(
    input: CompleteExpenseClarificationInput,
  ): Promise<CompleteExpenseClarificationOutcome> {
    const state = ExpenseClarificationState.fromPayload(input.statePayload);
    const enrichedMessage = `${state.rawMessage} ${input.rawReply}`.trim();

    return await this.registerExpense.interpret({
      userId: input.userId,
      rawMessage: enrichedMessage,
      channel: input.channel,
      ...(state.queueRegisteredCount === undefined
        ? {}
        : { queueRegisteredCount: state.queueRegisteredCount }),
    });
  }
}
