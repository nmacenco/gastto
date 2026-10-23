// LAYER: Application / Tests
// Unit tests for DetectCategories use case.

import { describe, it, expect, vi } from 'vitest';
import { DetectCategories } from './DetectCategories';
import type { DetectCategoriesDeps } from './DetectCategories';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { ICategoryReaderPort } from '../../../domain/ports/categoryReader';
import type { ICategoryVocabularyRepository } from '../../../domain/ports/repositories';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

describe('DetectCategories', () => {
  function buildColumnMappingRepository(mappings: unknown[]) {
    return {
      findBySpreadsheetId: vi.fn().mockResolvedValue(mappings),
      upsertMany: vi.fn(),
      confirm: vi.fn(),
      confirmBySpreadsheetId: vi.fn(),
      updateCorrected: vi.fn(),
    } as unknown as DetectCategoriesDeps['columnMappingRepository'];
  }

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
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({
          readHierarchy: vi.fn().mockResolvedValue({
            categories: ['comida', 'transporte'],
            pairs: [],
            orphanSubcategories: [],
          }),
        }),
      },
      oauthAccessTokenService: {
        getValidAccessToken: vi.fn().mockResolvedValue({
          accessToken: 'access-token',
          expiresAt: new Date(Date.now() + 3600_000),
          refreshed: false,
        }),
        forceRefreshAccessToken: vi.fn().mockResolvedValue({
          accessToken: 'refreshed-access-token',
          expiresAt: new Date(Date.now() + 3600_000),
          refreshed: true,
        }),
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
        findBySpreadsheetId: vi.fn().mockResolvedValue(null),
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
    expect(payload?.categories).toEqual([
      { name: 'comida', subcategories: [] },
      { name: 'transporte', subcategories: [] },
    ]);
    expect(payload?.subcategoryColumnMapped).toBe(false);
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(result.message).toContain('comida');
  });

  it('starts reading below the detected header row', async () => {
    const readCategories = vi.fn().mockResolvedValue(['comida', 'transporte']);
    const { deps, sendMessage } = buildDeps({
      categoryReaderPortFactory: {
        create: vi.fn().mockReturnValue({ readCategories }),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: { headerRowIndex: 2 },
    });

    expect(readCategories).toHaveBeenCalledWith('file-123', 2, 'Gastos', 3);
    expect(result.categories).toEqual(['comida', 'transporte']);
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('comida'));
    expect(sendMessage).not.toHaveBeenCalledWith('123456789', expect.stringContaining('categoria'));
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
    expect(payload?.categories).toEqual(
      ['alimentacion', 'transporte', 'servicios', 'ocio', 'salud', 'otros'].map((name) => ({
        name,
        subcategories: [],
      })),
    );
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

  it('reads onboarding categories with a proactively refreshed expired token', async () => {
    const readCategories = vi.fn().mockResolvedValue(['comida']);
    const createCategoryReader = vi.fn().mockReturnValue({ readCategories });
    const { deps, transitionExecute } = buildDeps({
      categoryReaderPortFactory: {
        create: createCategoryReader,
      },
      oauthAccessTokenService: {
        getValidAccessToken: vi.fn().mockResolvedValue({
          accessToken: 'refreshed-access-token',
          expiresAt: new Date(Date.now() + 3600_000),
          refreshed: true,
        }),
        forceRefreshAccessToken: vi.fn(),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: { provider: 'google' },
    });

    expect(createCategoryReader).toHaveBeenCalledWith('refreshed-access-token');
    expect(readCategories).toHaveBeenCalledTimes(1);
    expect(result.categories).toEqual(['comida']);
    expect(transitionExecute).not.toHaveBeenCalledWith(
      expect.objectContaining({ targetState: 'ONBOARDING_START' }),
    );
  });

  it('reconnects only for terminal authorization failure', async () => {
    const { deps, sendMessage, transitionExecute, saveVocabulary } = buildDeps({
      oauthAccessTokenService: {
        getValidAccessToken: vi
          .fn()
          .mockRejectedValue(new SpreadsheetError('revoked', { code: 'AUTH_ERROR' })),
        forceRefreshAccessToken: vi.fn(),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    expect(result).toEqual({
      categories: [],
      state: { categories: [], orphanSubcategories: [], subcategoryColumnMapped: false },
      message: onboardingCopies.reconnectAccount(),
    });
    expect(sendMessage).toHaveBeenCalledWith('123456789', onboardingCopies.reconnectAccount());
    expect(transitionExecute).toHaveBeenCalledWith({
      userId: 'user-123',
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    expect(saveVocabulary).not.toHaveBeenCalled();
  });

  it('does not send placeholders or restart onboarding for transient token failures', async () => {
    const { deps, sendMessage, transitionExecute, saveVocabulary } = buildDeps({
      oauthAccessTokenService: {
        getValidAccessToken: vi
          .fn()
          .mockRejectedValue(
            new SpreadsheetError('temporary', { code: 'NETWORK_ERROR', retryable: true }),
          ),
        forceRefreshAccessToken: vi.fn(),
      },
    });

    await expect(
      new DetectCategories(deps).execute({
        userId: 'user-123',
        externalId: '123456789',
        channel: 'telegram',
        statePayload: null,
      }),
    ).rejects.toMatchObject({ code: 'NETWORK_ERROR' });

    expect(sendMessage).not.toHaveBeenCalled();
    expect(transitionExecute).not.toHaveBeenCalled();
    expect(saveVocabulary).not.toHaveBeenCalled();
  });

  it('reads a mapped hierarchy once and persists parent-scoped children', async () => {
    const readHierarchy = vi.fn().mockResolvedValue({
      categories: ['food', 'leisure'],
      pairs: [
        { category: 'food', subcategory: 'restaurant' },
        { category: 'food', subcategory: 'groceries' },
        { category: 'leisure', subcategory: 'restaurant' },
      ],
      orphanSubcategories: [],
    });
    const readCategories = vi.fn();
    const { deps, saveVocabulary } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 2, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 4, columnHeader: 'Subcategory' },
      ]),
      categoryReaderPortFactory: { create: vi.fn().mockReturnValue({ readCategories }) },
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({ readHierarchy }),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: { headerRowIndex: 2 },
    });

    expect(readHierarchy).toHaveBeenCalledOnce();
    expect(readHierarchy).toHaveBeenCalledWith('file-123', 2, 4, 'Gastos', 3);
    expect(readCategories).not.toHaveBeenCalled();
    expect(result.state).toEqual({
      categories: [
        { name: 'food', subcategories: ['restaurant', 'groceries'] },
        { name: 'leisure', subcategories: ['restaurant'] },
      ],
      orphanSubcategories: [],
      subcategoryColumnMapped: true,
    });
    const saved = saveVocabulary.mock.calls[0]?.[0];
    expect(saved?.getSubcategories()).toHaveLength(3);
  });

  it('keeps category-only hierarchy rows and excludes reported orphans', async () => {
    const { deps, sendMessage } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 2, columnHeader: 'Subcategory' },
      ]),
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({
          readHierarchy: vi.fn().mockResolvedValue({
            categories: ['food', 'health'],
            pairs: [{ category: 'food', subcategory: 'groceries' }],
            orphanSubcategories: ['streaming', 'cinema'],
          }),
        }),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'whatsapp',
      statePayload: null,
    });

    expect(result.state.categories).toEqual([
      { name: 'food', subcategories: ['groceries'] },
      { name: 'health', subcategories: [] },
    ]);
    expect(result.state.orphanSubcategories).toEqual(['streaming', 'cinema']);
    expect(sendMessage).toHaveBeenCalledWith('123456789', expect.stringContaining('streaming'));
    expect(sendMessage).toHaveBeenCalledWith(
      '123456789',
      expect.stringContaining('no tenían una categoría padre asignada'),
    );
  });

  it('uses category-only defaults when a mapped hierarchy has no valid parent', async () => {
    const { deps } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 2, columnHeader: 'Subcategory' },
      ]),
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({
          readHierarchy: vi.fn().mockResolvedValue({
            categories: [],
            pairs: [],
            orphanSubcategories: ['streaming'],
          }),
        }),
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    expect(result.categories).toEqual([
      'alimentacion',
      'transporte',
      'servicios',
      'ocio',
      'salud',
      'otros',
    ]);
    expect(result.state.categories.every((category) => category.subcategories.length === 0)).toBe(
      true,
    );
    expect(result.state.orphanSubcategories).toEqual(['streaming']);
  });

  it('merges an active vocabulary while preserving stable identifiers', async () => {
    const persisted = new CategoryVocabulary(
      'config-123',
      [{ id: 'food-id', name: 'food', normalizedName: 'food' }],
      [
        {
          id: 'manual-id',
          categoryId: 'food-id',
          name: 'manual',
          normalizedName: 'manual',
        },
      ],
    );
    const saveVocabulary = vi
      .fn<ICategoryVocabularyRepository['save']>()
      .mockResolvedValue(undefined);
    const { deps } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 2, columnHeader: 'Subcategory' },
      ]),
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({
          readHierarchy: vi.fn().mockResolvedValue({
            categories: ['food'],
            pairs: [{ category: 'food', subcategory: 'restaurant' }],
            orphanSubcategories: [],
          }),
        }),
      },
      categoryVocabularyRepository: {
        findBySpreadsheetId: vi.fn().mockResolvedValue(persisted),
        save: saveVocabulary,
      },
    });

    const result = await new DetectCategories(deps).execute({
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram',
      statePayload: null,
    });

    const saved = saveVocabulary.mock.calls[0]?.[0];
    expect(saved?.getCategories()[0]?.id).toBe('food-id');
    expect(saved?.getSubcategories().map((subcategory) => subcategory.id)).toContain('manual-id');
    expect(result.state.categories).toEqual([
      { name: 'food', subcategories: ['manual', 'restaurant'] },
    ]);
  });

  it('does not send or transition when hierarchy persistence fails', async () => {
    const { deps, sendMessage, transitionExecute } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 2, columnHeader: 'Subcategory' },
      ]),
      categoryVocabularyRepository: {
        findBySpreadsheetId: vi.fn().mockResolvedValue(null),
        save: vi.fn().mockRejectedValue(new Error('database unavailable')),
      },
    });

    await expect(
      new DetectCategories(deps).execute({
        userId: 'user-123',
        externalId: '123456789',
        channel: 'telegram',
        statePayload: null,
      }),
    ).rejects.toThrow('database unavailable');
    expect(sendMessage).not.toHaveBeenCalled();
    expect(transitionExecute).not.toHaveBeenCalled();
  });

  it('keeps repeated hierarchy detection idempotent', async () => {
    const persisted = new CategoryVocabulary('config-123');
    const category = persisted.addCategory('food');
    persisted.addSubcategory(category.id, 'restaurant');
    const saveVocabulary = vi
      .fn<ICategoryVocabularyRepository['save']>()
      .mockResolvedValue(undefined);
    const { deps } = buildDeps({
      columnMappingRepository: buildColumnMappingRepository([
        { GasttoField: 'categoria', columnIndex: 1, columnHeader: 'Category' },
        { GasttoField: 'subcategoria', columnIndex: 2, columnHeader: 'Subcategory' },
      ]),
      categoryVocabularyRepository: {
        findBySpreadsheetId: vi.fn().mockResolvedValue(persisted),
        save: saveVocabulary,
      },
      categoryHierarchyReaderPortFactory: {
        create: vi.fn().mockReturnValue({
          readHierarchy: vi.fn().mockResolvedValue({
            categories: ['food'],
            pairs: [{ category: 'food', subcategory: 'restaurant' }],
            orphanSubcategories: [],
          }),
        }),
      },
    });

    const input = {
      userId: 'user-123',
      externalId: '123456789',
      channel: 'telegram' as const,
      statePayload: null,
    };
    const useCase = new DetectCategories(deps);
    const first = await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(first.state).toEqual(second.state);
    expect(persisted.getCategories()).toHaveLength(1);
    expect(persisted.getSubcategories()).toHaveLength(1);
    expect(saveVocabulary).toHaveBeenCalledTimes(2);
  });
});
