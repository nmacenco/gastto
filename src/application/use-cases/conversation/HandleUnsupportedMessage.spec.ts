// LAYER: Application / Tests
// Unit tests for HandleUnsupportedMessage.
// Verifies the exact copy is sent and no error is thrown.

import { describe, it, expect, vi } from 'vitest';
import { HandleUnsupportedMessage, UNSUPPORTED_MESSAGE_COPY } from './HandleUnsupportedMessage';

describe('HandleUnsupportedMessage', () => {
  it('sends the exact unsupported copy via the messaging port', async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const handler = new HandleUnsupportedMessage({ sendMessage });

    await handler.execute('123456789');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('123456789', UNSUPPORTED_MESSAGE_COPY);
  });

  it('does not throw when the messaging port rejects', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Network timeout'));
    const handler = new HandleUnsupportedMessage({ sendMessage });

    await expect(handler.execute('123456789')).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
