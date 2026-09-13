// LAYER: Application
// Use case: undo the last registered expense (E1-US-11, ADR-006).
// Deletes the spreadsheet row and soft deletes in expense_records.

import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import type {
  IExpenseRecordRepository,
  ISpreadsheetConfigRepository,
  IOperationLogRepository,
} from '../../../domain/ports/repositories';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import {
  executeWithOAuthAccessToken,
  type OAuthAccessTokenProvider,
} from '../../services/OAuthAccessTokenService';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import { randomUUID } from 'node:crypto';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';

export interface UndoLastExpenseOutput {
  status: 'deleted' | 'confirmation_required' | 'not_found' | 'deletion_failed';
  expense?: { id: string; concepto: string; monto: number; moneda: string; savedAt: Date };
  errorType?: 'NETWORK_ERROR' | 'AUTH_ERROR' | 'STRUCTURE_ERROR';
}

export interface UndoLastExpenseInput {
  userId: string;
  action: 'request' | 'confirm';
  immediateExpenseId?: string | undefined;
  pendingExpenseId?: string | undefined;
}

export class UndoLastExpenseUseCase {
  constructor(
    private readonly spreadsheetPortFactory: SpreadsheetPortFactory,
    private readonly expenseRepo: IExpenseRecordRepository,
    private readonly spreadsheetConfigRepo: ISpreadsheetConfigRepository,
    private readonly logRepo: IOperationLogRepository,
    private readonly oauthAccessTokenService: OAuthAccessTokenProvider,
    private readonly transitionState: TransitionConversationState,
  ) {}

  async execute(input: UndoLastExpenseInput): Promise<UndoLastExpenseOutput> {
    // 1. Retrieves the last non-deleted record
    const last = await this.expenseRepo.findLatestByUserId(input.userId);
    if (!last) return { status: 'not_found' };

    const expense = {
      id: last.id,
      concepto: last.concepto,
      monto: last.monto,
      moneda: last.moneda,
      savedAt: last.savedAt,
    };

    if (input.action === 'request' && input.immediateExpenseId !== last.id) {
      return { status: 'confirmation_required', expense };
    }
    if (input.action === 'confirm' && input.pendingExpenseId !== last.id) {
      return { status: 'not_found' };
    }

    const claimId = randomUUID();
    const executionClaim = {
      claimId,
      kind: 'undo' as const,
      operationId: `${input.userId}:${last.id}:undo`,
      sourceMessageId: null,
      status: 'in_flight' as const,
      target: { expenseId: last.id, sheetName: last.sheetName, rowIndex: last.rowIndex },
    };
    await this.transitionState.execute({
      userId: input.userId,
      targetState: 'IDLE',
      payload: { executionClaim },
      claimId,
    });

    const config = await this.spreadsheetConfigRepo.findByUserId(input.userId);
    if (!config || last.rowIndex === null || config.provider !== 'google') {
      await this.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'IDLE',
        payload: null,
        claimId,
      });
      return { status: 'deletion_failed', errorType: 'STRUCTURE_ERROR' };
    }

    let remoteDeletionCompleted = false;
    try {
      await this.transitionState.assertCanStartFinancialEffect(input.userId, claimId);
      // 2. Elimina la fila de la planilla real
      await executeWithOAuthAccessToken(
        this.oauthAccessTokenService,
        { userId: input.userId, provider: config.provider },
        (accessToken) =>
          this.spreadsheetPortFactory
            .create(accessToken)
            .deleteRow(config.fileId, last.sheetName, last.rowIndex!),
      );
      remoteDeletionCompleted = true;

      // 3. Soft delete and audit are one local transaction.
      await this.expenseRepo.softDeleteWithAudit(last.id, input.userId, {
        expenseId: last.id,
        concepto: last.concepto,
        monto: last.monto,
        moneda: last.moneda,
        sheet: last.sheetName,
        row: last.rowIndex,
      });

      await this.transitionState.finalizeClaim({
        userId: input.userId,
        targetState: 'IDLE',
        payload: null,
        claimId,
      });

      return { status: 'deleted', expense };
    } catch (error: unknown) {
      if (error instanceof StaleConversationStateError) throw error;
      const errorType = this.classifyError(error);

      await this.logRepo.create(input.userId, 'EXPENSE_SAVE_FAILED', { phase: 'undo' }, errorType);

      const outcomeUnknown =
        remoteDeletionCompleted || (error instanceof SpreadsheetError && error.outcomeUnknown);
      await this.transitionState.finalizeClaim(
        outcomeUnknown
          ? {
              userId: input.userId,
              targetState: 'IDLE',
              payload: {
                executionClaim: { ...executionClaim, status: 'outcome_unknown' },
              },
              claimId,
            }
          : {
              userId: input.userId,
              targetState: 'IDLE',
              payload: null,
              claimId,
            },
      );

      return { status: 'deletion_failed', errorType };
    }
  }

  private classifyError(error: unknown): 'NETWORK_ERROR' | 'AUTH_ERROR' | 'STRUCTURE_ERROR' {
    if (error instanceof SpreadsheetError && error.code !== 'UNKNOWN') {
      return error.code;
    }
    if (error instanceof Error) {
      const msg = error.message.toLowerCase();
      if (msg.includes('401') || msg.includes('403') || msg.includes('unauthorized'))
        return 'AUTH_ERROR';
      if (msg.includes('not found') || msg.includes('range') || msg.includes('structure'))
        return 'STRUCTURE_ERROR';
    }
    return 'NETWORK_ERROR';
  }
}
