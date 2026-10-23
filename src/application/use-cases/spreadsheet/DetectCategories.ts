// LAYER: Application
// Use case: detect the linked category vocabulary from the user's spreadsheet.

import type {
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryReaderPortFactory } from '../../../domain/ports/categoryReader';
import type {
  CategoryHierarchyReadResult,
  ICategoryHierarchyReaderPortFactory,
} from '../../../domain/ports/categoryHierarchyReader';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import {
  executeWithOAuthAccessToken,
  type OAuthAccessTokenProvider,
} from '../../services/OAuthAccessTokenService';
import {
  serializeCategoryOnboardingState,
  type CategoryOnboardingState,
} from '../../dtos/CategoryOnboardingState';

export interface DetectCategoriesInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface DetectCategoriesOutput {
  categories: string[];
  state: CategoryOnboardingState;
  message: string;
}

export interface DetectCategoriesDeps {
  categoryReaderPortFactory: ICategoryReaderPortFactory;
  categoryHierarchyReaderPortFactory: ICategoryHierarchyReaderPortFactory;
  oauthAccessTokenService: OAuthAccessTokenProvider;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
}

const DEFAULT_CATEGORIES = ['Alimentacion', 'Transporte', 'Servicios', 'Ocio', 'Salud', 'Otros'];

export class DetectCategories {
  constructor(private readonly deps: DetectCategoriesDeps) {}

  async execute(input: DetectCategoriesInput): Promise<DetectCategoriesOutput> {
    const { userId, externalId, statePayload } = input;
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) return this.sendPlaceholder(externalId, userId, statePayload);

    const mappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
    const categoryMapping = mappings.find((mapping) => mapping.GasttoField === 'categoria');
    if (!categoryMapping) return this.sendPlaceholder(externalId, userId, statePayload);

    const subcategoryMapping = mappings.find((mapping) => mapping.GasttoField === 'subcategoria');
    const dataStartRow = resolveDataStartRow(statePayload);

    try {
      if (subcategoryMapping) {
        const hierarchy = await executeWithOAuthAccessToken(
          this.deps.oauthAccessTokenService,
          { userId, provider: config.provider },
          (accessToken) =>
            this.deps.categoryHierarchyReaderPortFactory
              .create(accessToken)
              .readHierarchy(
                config.fileId,
                categoryMapping.columnIndex,
                subcategoryMapping.columnIndex,
                config.sheetName,
                dataStartRow,
              ),
        );
        return await this.persistHierarchyAndPrompt(
          config.id,
          hierarchy,
          externalId,
          userId,
          statePayload,
        );
      }

      const categories = await executeWithOAuthAccessToken(
        this.deps.oauthAccessTokenService,
        { userId, provider: config.provider },
        (accessToken) =>
          this.deps.categoryReaderPortFactory
            .create(accessToken)
            .readCategories(
              config.fileId,
              categoryMapping.columnIndex,
              config.sheetName,
              dataStartRow,
            ),
      );
      return await this.persistFlatAndPrompt(
        config.id,
        categories,
        externalId,
        userId,
        statePayload,
      );
    } catch (error) {
      if (error instanceof SpreadsheetError && error.code === 'AUTH_ERROR') {
        return this.sendReconnect(externalId, userId);
      }
      throw error;
    }
  }

  private async persistFlatAndPrompt(
    spreadsheetId: string,
    detectedCategories: string[],
    externalId: string,
    userId: string,
    statePayload: Record<string, unknown> | null,
  ): Promise<DetectCategoriesOutput> {
    const categories =
      detectedCategories.length > 0
        ? detectedCategories
        : DEFAULT_CATEGORIES.map((category) => category.toLowerCase());
    const vocabulary = new CategoryVocabulary(spreadsheetId);
    for (const category of categories) vocabulary.addCategory(category);
    await this.deps.categoryVocabularyRepository.save(vocabulary);

    const state = toOnboardingState(vocabulary, [], false);
    const message = onboardingCopies.categoryConfirmationPrompt(categories);
    await this.sendProposal(externalId, userId, statePayload, state, message);
    return { categories, state, message };
  }

  private async persistHierarchyAndPrompt(
    spreadsheetId: string,
    hierarchy: CategoryHierarchyReadResult,
    externalId: string,
    userId: string,
    statePayload: Record<string, unknown> | null,
  ): Promise<DetectCategoriesOutput> {
    const detectedCategories =
      hierarchy.categories.length > 0
        ? hierarchy.categories
        : DEFAULT_CATEGORIES.map((category) => category.toLowerCase());
    const vocabulary =
      (await this.deps.categoryVocabularyRepository.findBySpreadsheetId(spreadsheetId)) ??
      new CategoryVocabulary(spreadsheetId);

    for (const categoryName of detectedCategories) addCategoryIfMissing(vocabulary, categoryName);
    for (const pair of hierarchy.pairs) {
      const parent = addCategoryIfMissing(vocabulary, pair.category);
      if (!vocabulary.findSubcategory(parent.id, pair.subcategory)) {
        vocabulary.addSubcategory(parent.id, pair.subcategory);
      }
    }
    await this.deps.categoryVocabularyRepository.save(vocabulary);

    const state = toOnboardingState(vocabulary, hierarchy.orphanSubcategories, true);
    const categories = state.categories.map((category) => category.name);
    const message = onboardingCopies.categoryHierarchyConfirmationPrompt(
      state.categories,
      state.orphanSubcategories,
    );
    await this.sendProposal(externalId, userId, statePayload, state, message);
    return { categories, state, message };
  }

  private async sendProposal(
    externalId: string,
    userId: string,
    previousPayload: Record<string, unknown> | null,
    state: CategoryOnboardingState,
    message: string,
  ): Promise<void> {
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: serializeCategoryOnboardingState(state, previousPayload),
    });
  }

  private async sendPlaceholder(
    externalId: string,
    userId: string,
    statePayload: Record<string, unknown> | null,
  ): Promise<DetectCategoriesOutput> {
    const categories = DEFAULT_CATEGORIES.map((category) => category.toLowerCase());
    const state: CategoryOnboardingState = {
      categories: categories.map((name) => ({ name, subcategories: [] })),
      orphanSubcategories: [],
      subcategoryColumnMapped: false,
    };
    const message = onboardingCopies.onboardingPlaceholder();
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: serializeCategoryOnboardingState(state, statePayload),
    });
    return { categories, state, message };
  }

  private async sendReconnect(externalId: string, userId: string): Promise<DetectCategoriesOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    return {
      categories: [],
      state: { categories: [], orphanSubcategories: [], subcategoryColumnMapped: false },
      message,
    };
  }
}

function addCategoryIfMissing(vocabulary: CategoryVocabulary, name: string) {
  const normalizedName = name.trim().toLowerCase();
  const existing = vocabulary
    .getCategories()
    .find((category) => category.normalizedName === normalizedName);
  return existing ?? vocabulary.addCategory(name);
}

function toOnboardingState(
  vocabulary: CategoryVocabulary,
  orphanSubcategories: string[],
  subcategoryColumnMapped: boolean,
): CategoryOnboardingState {
  return {
    categories: vocabulary.getCategories().map((category) => ({
      name: category.name,
      subcategories: vocabulary
        .getSubcategories(category.id)
        .map((subcategory) => subcategory.name),
    })),
    orphanSubcategories: [...orphanSubcategories],
    subcategoryColumnMapped,
  };
}

function resolveDataStartRow(statePayload: Record<string, unknown> | null): number | undefined {
  const headerRowIndex = statePayload?.headerRowIndex;
  if (
    typeof headerRowIndex !== 'number' ||
    !Number.isInteger(headerRowIndex) ||
    headerRowIndex < 1
  ) {
    return undefined;
  }
  return headerRowIndex + 1;
}
