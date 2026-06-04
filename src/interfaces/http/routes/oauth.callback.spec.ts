// LAYER: Interfaces / Tests
// Contract tests for the OAuth callback route.
// Mocks HandleOAuthCallback to verify route layer behavior independently.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { registerOAuthCallback, type OAuthCallbackDeps } from './oauth.callback';
import type { HandleOAuthCallback } from '../../../application/use-cases/spreadsheet/HandleOAuthCallback';

const mockExecute = vi.fn();

function buildMockDeps(): OAuthCallbackDeps {
  return {
    handleOAuthCallback: { execute: mockExecute } as unknown as HandleOAuthCallback,
  };
}

function buildApp(deps: OAuthCallbackDeps = buildMockDeps()) {
  const app = Fastify({ logger: false });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerOAuthCallback(app, deps);
  return { app, deps };
}

describe('GET /auth/google/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success HTML when use case succeeds', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      nextState: 'ONBOARDING_FILE',
      message: 'Google Drive connected!',
    });

    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=auth-code-123&state=csrf-state-456',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('You can close this window');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({ code: 'auth-code-123', state: 'csrf-state-456' });
  });

  it('returns failure HTML when use case fails', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      nextState: 'ONBOARDING_DRIVE',
      message: 'Connection failed. Please try again.',
      canRetry: true,
    });

    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=auth-code-123&state=csrf-state-456',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Connection failed');
    expect(mockExecute).toHaveBeenCalledWith({ code: 'auth-code-123', state: 'csrf-state-456' });
  });

  it('returns 400 when code query param is missing', async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?state=csrf-state-456',
    });

    expect(response.statusCode).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when state query param is missing', async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=auth-code-123',
    });

    expect(response.statusCode).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('GET /auth/microsoft/callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns success HTML when use case succeeds', async () => {
    mockExecute.mockResolvedValue({
      success: true,
      nextState: 'ONBOARDING_FILE',
      message: 'OneDrive connected!',
    });

    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/microsoft/callback?code=auth-code-789&state=csrf-state-abc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('You can close this window');
    expect(mockExecute).toHaveBeenCalledTimes(1);
    expect(mockExecute).toHaveBeenCalledWith({ code: 'auth-code-789', state: 'csrf-state-abc' });
  });

  it('returns failure HTML when use case fails', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      nextState: 'ONBOARDING_DRIVE',
      message: 'Microsoft connection failed. Please try again.',
      canRetry: true,
    });

    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/microsoft/callback?code=auth-code-789&state=csrf-state-abc',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.payload).toContain('Microsoft connection failed');
    expect(mockExecute).toHaveBeenCalledWith({ code: 'auth-code-789', state: 'csrf-state-abc' });
  });

  it('returns 400 when code query param is missing', async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/microsoft/callback?state=csrf-state-abc',
    });

    expect(response.statusCode).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns 400 when state query param is missing', async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/microsoft/callback?code=auth-code-789',
    });

    expect(response.statusCode).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });
});
