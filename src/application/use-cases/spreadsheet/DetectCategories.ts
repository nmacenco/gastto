// LAYER: Application
// Use case: detect the existing category vocabulary from the user's spreadsheet.
// Used when entering the ONBOARDING_CATEGORIES state after column mapping is confirmed.

import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { ICategoryReaderPortFactory } from '../../../domain/ports/categoryReader';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { onboardingCopies } from '../../copies/onboarding.copies';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';

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
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
}

const DEFAULT_CATEGORIES = ['Alimentacion', 'Transporte', 'Servicios', 'Ocio', 'Salud', 'Otros'];

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export class DetectCategories {
  constructor(private readonly deps: DetectCategoriesDeps) {}

  async execute(input: DetectCategoriesInput): Promise<DetectCategoriesOutput> {
    const { userId, externalId, statePayload } = input;

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, config.provider);
    if (!token || token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    const mappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
    const categoryMapping = mappings.find((m) => m.GasttoField === 'categoria');
    if (!categoryMapping) {
      return this.sendPlaceholder(externalId, userId, statePayload);
    }

    const categoryReader = this.deps.categoryReaderPortFactory.create(accessToken);

    let categories: string[];
    try {
      categories = await categoryReader.readCategories(
        config.fileId,
        categoryMapping.columnIndex,
        config.sheetName,
      );
    } catch {
      categories = [];
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
}
