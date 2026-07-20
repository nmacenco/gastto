// LAYER: Application / Tests
// Unit tests for SendExpenseGuidance.
// Verifies the exact guidance copy is sent and no error is thrown.

import { describe, it, expect, vi } from 'vitest';
import { SendExpenseGuidance } from './SendExpenseGuidance';
import { sharedCopies } from '../../copies/shared.copies';

describe('SendExpenseGuidance', () => {
  it('sends the expense guidance copy via the messaging port', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ status: 'success' });
    const useCase = new SendExpenseGuidance({ sendMessage });

    await useCase.execute('123456789');

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('123456789', sharedCopies.expenseGuidance());
  });

  it('does not throw when the messaging port rejects', async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error('Network timeout'));
    const useCase = new SendExpenseGuidance({ sendMessage });

    await expect(useCase.execute('123456789')).resolves.toBeUndefined();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });
});
