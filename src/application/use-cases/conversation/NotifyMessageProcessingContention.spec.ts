import { describe, expect, it, vi } from 'vitest';
import type { Logger } from 'pino';
import { sharedCopies } from '../../copies/shared.copies';
import { NotifyMessageProcessingContention } from './NotifyMessageProcessingContention';

const input = {
  channel: 'telegram' as const,
  externalId: 'chat-1',
  externalMessageId: 'message-1',
};

describe('NotifyMessageProcessingContention', () => {
  it('sends the fixed safe-resend copy to the selected channel', async () => {
    const telegram = vi.fn().mockResolvedValue({ status: 'success' });
    const whatsapp = vi.fn().mockResolvedValue({ status: 'success' });
    const logger = { error: vi.fn() } as unknown as Logger;
    const service = new NotifyMessageProcessingContention(
      { telegram: { sendMessage: telegram }, whatsapp: { sendMessage: whatsapp } },
      logger,
    );

    await service.execute({ ...input, channel: 'whatsapp' });

    expect(whatsapp).toHaveBeenCalledOnce();
    expect(whatsapp).toHaveBeenCalledWith('chat-1', sharedCopies.processingContentionExhausted());
    expect(telegram).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(['failure', 'rejection'] as const)(
    'logs a %s without throwing or using the input text',
    async (kind) => {
      const sendMessage =
        kind === 'failure'
          ? vi.fn().mockResolvedValue({ status: 'failure', errorCode: 'UNAVAILABLE' })
          : vi.fn().mockRejectedValue(new Error('provider unavailable'));
      const logger = { error: vi.fn() } as unknown as Logger;
      const service = new NotifyMessageProcessingContention(
        { telegram: { sendMessage }, whatsapp: { sendMessage } },
        logger,
      );

      await expect(service.execute(input)).resolves.toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          endpoint: 'NotifyMessageProcessingContention',
          code: 'CONTENTION_NOTICE_FAILED',
          externalMessageId: 'message-1',
        }),
      );
    },
  );
});
