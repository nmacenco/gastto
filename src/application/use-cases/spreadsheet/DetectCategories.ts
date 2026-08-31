// LAYER: Application
// Use case: detect the existing category vocabulary from the user's spreadsheet.
// Used when entering the ONBOARDING_CATEGORIES state after column mapping is confirmed.

import type {
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { ICategoryReaderPortFactory } from '../../../domain/ports/categoryReader';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { SpreadsheetError } from '../../../domain/errors/SpreadsheetError';
import {
  executeWithOAuthAccessToken,
  type OAuthAccessTokenProvider,
} from '../../services/OAuthAccessTokenService';

export interface DetectCategoriesInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface DetectCategoriesOutput {
  categories: string[];
  message: string;
}

export interface DetectCategoriesDeps {
  categoryReaderPortFactory: ICategoryReaderPortFactory;
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
    if (!config) {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    const mappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
    const categoryMapping = mappings.find((m) => m.GasttoField === 'categoria');
    if (!categoryMapping) {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    let categories: string[];
    const dataStartRow = resolveDataStartRow(statePayload);
    try {
      categories = await executeWithOAuthAccessToken(
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
    } catch (error) {
      if (error instanceof SpreadsheetError && error.code === 'AUTH_ERROR') {
        return this.sendReconnect(externalId, userId);
      }
      throw error;
    }

    if (categories.length === 0) {
      categories = DEFAULT_CATEGORIES.map((c) => c.toLowerCase());
    }

    // Build and persist the category vocabulary
    const vocabulary = new CategoryVocabulary(config.id);
    for (const cat of categories) {
      vocabulary.addCategory(cat);
    }
    await this.deps.categoryVocabularyRepository.save(vocabulary);

    const message = onboardingCopies.categoryConfirmationPrompt(categories);
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: {
        ...statePayload,
        categories,
      },
    });

    return { categories, message };
  }

  private async sendPlaceholder(
    externalId: string,
    userId: string,
    statePayload: Record<string, unknown> | null,
  ): Promise<DetectCategoriesOutput> {
    const categories = DEFAULT_CATEGORIES.map((c) => c.toLowerCase());
    await this.deps.messagingPort.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: { ...statePayload, categories },
    });
    return { categories, message: onboardingCopies.onboardingPlaceholder() };
  }

  private async sendReconnect(externalId: string, userId: string): Promise<DetectCategoriesOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    return { categories: [], message };
  }
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
