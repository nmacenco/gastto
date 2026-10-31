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

  it('declares UTF-8 for accented failure messages', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      nextState: 'ONBOARDING_DRIVE',
      message: 'Hacé clic para intentar de nuevo.',
      canRetry: true,
    });

    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=auth-code-123&state=csrf-state-456',
    });

    expect(response.headers['content-type']).toContain('charset=utf-8');
    expect(response.payload).toContain('<meta charset="utf-8">');
    expect(response.payload).toContain('Hacé clic');
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

  it('accepts provider denial with state and never reflects provider text into HTML', async () => {
    mockExecute.mockResolvedValue({
      success: false,
      nextState: 'IDLE',
      message: 'No se autorizó Google.',
    });
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied&state=csrf-state-456&error_description=%3Cscript%3E',
    });
    expect(response.statusCode).toBe(200);
    expect(response.payload).not.toContain('<script>');
    expect(mockExecute).toHaveBeenCalledWith({ error: 'access_denied', state: 'csrf-state-456' });
  });

  it('rejects callback without state even on provider denial', async () => {
    const { app } = buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?error=access_denied',
    });
    expect(response.statusCode).toBe(400);
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('rejects an empty state and ambiguous success/denial query', async () => {
    const { app } = buildApp();
    const empty = await app.inject({ method: 'GET', url: '/auth/google/callback?code=x&state=' });
    const ambiguous = await app.inject({
      method: 'GET',
      url: '/auth/google/callback?code=x&error=access_denied&state=y',
    });
    expect(empty.statusCode).toBe(400);
    expect(ambiguous.statusCode).toBe(400);
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
