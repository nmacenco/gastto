// LAYER: Application / Tests
// Contract tests for MessagingOutputPort and SendResult.
// Verifies the discriminated union narrows correctly and the
// interface signature matches the expected contract.

import { describe, it, expect, vi } from 'vitest';
import type { MessagingOutputPort, SendResultSuccess, SendResultFailure } from './messaging.port';

describe('MessagingOutputPort contract', () => {
  it('accepts a success result', async () => {
    const mockSendMessage = vi
      .fn()
      .mockResolvedValue({ status: 'success' } satisfies SendResultSuccess);
    const port: MessagingOutputPort = { sendMessage: mockSendMessage };

    const result = await port.sendMessage('123', 'hello');

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result).toEqual({ status: 'success' });
    } else {
      throw new Error('Expected success result to narrow');
    }
  });

  it('accepts a failure result', async () => {
    const mockSendMessage = vi.fn().mockResolvedValue({
      status: 'failure',
      errorCode: 'SEND_FAILED',
    } satisfies SendResultFailure);
    const port: MessagingOutputPort = { sendMessage: mockSendMessage };

    const result = await port.sendMessage('123', 'hello');

    expect(result.status).toBe('failure');
    if (result.status === 'failure') {
      expect(result.errorCode).toBe('SEND_FAILED');
    } else {
      throw new Error('Expected failure result to narrow');
    }
  });

  it('has the correct method signature', async () => {
    const mockSendMessage = vi
      .fn()
      .mockResolvedValue({ status: 'success' } satisfies SendResultSuccess);
    const port: MessagingOutputPort = { sendMessage: mockSendMessage };

    expect(typeof port.sendMessage).toBe('function');
    await expect(port.sendMessage('123', 'hello')).resolves.toEqual({ status: 'success' });
  });
});

describe('SendResult discriminated union', () => {
  it('success type has status success and no errorCode', () => {
    const success: SendResultSuccess = { status: 'success' };
    expect(success.status).toBe('success');
    // @ts-expect-error errorCode must not exist on success
    expect(success.errorCode).toBeUndefined();
  });

  it('failure type has status failure and errorCode', () => {
    const failure: SendResultFailure = { status: 'failure', errorCode: 'RATE_LIMITED' };
    expect(failure.status).toBe('failure');
    expect(failure.errorCode).toBe('RATE_LIMITED');
  });
});
