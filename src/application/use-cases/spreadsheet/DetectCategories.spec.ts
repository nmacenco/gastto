// LAYER: Application / Tests
// Unit tests for DetectCategories use case.

import { describe, it, expect, vi } from 'vitest';
import { DetectCategories } from './DetectCategories';
import type { DetectCategoriesDeps } from './DetectCategories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ICategoryReaderPort } from '../../../domain/ports/categoryReader';
import type { ICategoryVocabularyRepository } from '../../../domain/ports/repositories';

describe('DetectCategories', () => {
  function buildDeps(overrides: Partial<DetectCategoriesDeps> = {}): {
    deps: DetectCategoriesDeps;
    sendMessage: ReturnType<typeof vi.fn<MessagingOutputPort['sendMessage']>>;
    transitionExecute: ReturnType<typeof vi.fn>;
    saveVocabulary: ReturnType<typeof vi.fn<ICategoryVocabularyRepository['save']>>;
  } {
    const sendMessage = vi
      .fn<MessagingOutputPort['sendMessage']>()
      .mockResolvedValue({ status: 'success' });
    const transitionExecute = vi.fn().mockResolvedValue(undefined);
    const saveVocabulary = vi
      .fn<ICategoryVocabularyRepository['save']>()
      .mockResolvedValue(undefined);

    const mockCategoryReader: ICategoryReaderPort = {
      readCategories: vi.fn().mockResolvedValue(['comida', 'transporte']),
    };

    const deps = {
      categoryReaderPortFactory: {
        create: vi.fn().mockReturnValue(mockCategoryReader),
      },
      tokenRepository: {
        findByUserAndProvider: vi.fn().mockResolvedValue({
          accessTokenEnc: Buffer.from('enc'),
          iv: Buffer.from('iv'),
          accessTokenExpiresAt: new Date(Date.now() + 3600_000),
          revokedAt: null,
        }),
      },
      tokenEncryption: {
        decrypt: vi.fn().mockReturnValue('access-token'),
      },
      spreadsheetConfigRepository: {
        findByUserId: vi.fn().mockResolvedValue({
          id: 'config-123',
          provider: 'google',
          fileId: 'file-123',
          sheetName: 'Gastos',
        }),
        create: vi.fn(),
        upsertByUserId: vi.fn(),
        updateAccessVerified: vi.fn(),
        updateCategoriesConfirmed: vi.fn(),
      },
      columnMappingRepository: {
        findBySpreadsheetId: vi
          .fn()
          .mockResolvedValue([
            { GasttoField: 'categoria', columnIndex: 2, columnHeader: 'Categoria' },
          ]),
      },
      messagingPort: {
        sendMessage,
      },
      transitionState: {
        execute: transitionExecute,
      },
      categoryVocabularyRepository: {
        save: saveVocabulary,
      },
      ...overrides,
    } as unknown as DetectCategoriesDeps;

    return { deps, sendMessage, transitionExecute, saveVocabulary };
  }

  it('detects categories from the spreadsheet, persists vocabulary, and sends a confirmation prompt', async () => {
    const { deps, sendMessage, transitionExecute, saveVocabulary } = buildDeps();
    const useCase = new DetectCategories(deps);

    const result = await useCase.execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    expect(saveVocabulary).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('comida'));
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('transporte'));
    expect(transitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-123',
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
    const transitionCall = transitionExecute.mock.calls[0];
    if (!transitionCall) throw new Error('Expected transitionState.execute to be called');
    const payload = (transitionCall[0] as { payload?: Record<string, unknown> }).payload;
    expect(payload?.categories).toEqual(['comida', 'transporte']);
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(result.message).toContain('comida');
  });

  it('falls back to default categories when the column is empty and persists them', async () => {
    const emptyReader: ICategoryReaderPort = {
      readCategories: vi.fn().mockResolvedValue([]),
    };
    const { deps, sendMessage, transitionExecute, saveVocabulary } = buildDeps({
      categoryReaderPortFactory: {
        create: vi.fn().mockReturnValue(emptyReader),
      },
    });
    const useCase = new DetectCategories(deps);

    const result = await useCase.execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    expect(saveVocabulary).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('alimentacion'));
    expect(transitionExecute).toHaveBeenCalledWith(
      expect.objectContaining({
        targetState: 'ONBOARDING_CATEGORIES',
      }),
    );
    const transitionCall = transitionExecute.mock.calls[0];
    if (!transitionCall) throw new Error('Expected transitionState.execute to be called');
    const payload = (transitionCall[0] as { payload?: Record<string, unknown> }).payload;
    expect(payload?.categories).toEqual([
      'alimentacion',
      'transporte',
      'servicios',
      'ocio',
      'salud',
      'otros',
    ]);
    expect(result.categories).toEqual([
      'alimentacion',
      'transporte',
      'servicios',
      'ocio',
      'salud',
      'otros',
    ]);
  });

  it('falls back to defaults and does not persist when there is no spreadsheet config', async () => {
    const { deps, sendMessage, saveVocabulary } = buildDeps({
      spreadsheetConfigRepository: {
        findByUserId: vi.fn().mockResolvedValue(null),
        create: vi.fn(),
        upsertByUserId: vi.fn(),
        updateAccessVerified: vi.fn(),
        updateCategoriesConfirmed: vi.fn(),
      },
    });
    const useCase = new DetectCategories(deps);

    const result = await useCase.execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    expect(saveVocabulary).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('configurando'));
    expect(result.categories).toEqual([
      'alimentacion',
      'transporte',
      'servicios',
      'ocio',
      'salud',
      'otros',
    ]);
  });
});
