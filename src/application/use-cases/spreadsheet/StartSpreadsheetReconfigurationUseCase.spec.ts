import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StartSpreadsheetReconfigurationUseCase } from './StartSpreadsheetReconfigurationUseCase';
import type { ISpreadsheetConfigRepository } from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { ValidateSpreadsheetAccess } from './ValidateSpreadsheetAccess';

const findByUserId = vi.fn();
const transition = vi.fn();
const validate = vi.fn();
const sendMessage = vi.fn();

function buildUseCase() {
  return new StartSpreadsheetReconfigurationUseCase({
    spreadsheetConfigRepository: { findByUserId } as unknown as ISpreadsheetConfigRepository,
    transitionState: { execute: transition } as unknown as TransitionConversationState,
    validateSpreadsheetAccess: { execute: validate } as unknown as ValidateSpreadsheetAccess,
    messagingPort: { sendMessage },
  });
}

describe('StartSpreadsheetReconfigurationUseCase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transition.mockResolvedValue({});
    validate.mockResolvedValue({ nextState: 'ONBOARDING_MAPPING', message: '' });
    sendMessage.mockResolvedValue({ status: 'success' });
  });

  it('reuses the active Google configuration and eagerly validates it', async () => {
    findByUserId.mockResolvedValue({
      provider: 'google',
      fileId: 'file-1',
      fileName: 'Finanzas',
      sheetName: 'Gastos',
    });

    await buildUseCase().execute({ userId: 'user-123', chatId: 'chat-123', channel: 'telegram' });

    const payload = {
      selectedFileId: 'file-1',
      selectedFileName: 'Finanzas',
      selectedSheetName: 'Gastos',
      provider: 'google',
    };
    expect(transition).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_VALIDATING_ACCESS',
      payload,
    });
    expect(validate).toHaveBeenCalledWith({
      userId: 'user-123',
      externalId: 'chat-123',
      channel: 'telegram',
      statePayload: payload,
    });
  });
});
