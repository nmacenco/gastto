// LAYER: Application
// Use case: detect the existing category vocabulary from the user's spreadsheet.
// Used when entering the ONBOARDING_CATEGORIES state after column mapping is confirmed.

import type {
  IOAuthTokenRepository,
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
} from '../../../domain/ports/repositories';
import type { TokenEncryptionPort } from '../../../domain/ports/tokenEncryption';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { SpreadsheetCategoryReader } from '../../../infrastructure/adapters/sheets/SpreadsheetCategoryReader';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface DetectCategoriesInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface DetectCategoriesDeps {
  spreadsheetPortFactory: SpreadsheetPortFactory;
  tokenRepository: IOAuthTokenRepository;
  tokenEncryption: TokenEncryptionPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  columnMappingRepository: IColumnMappingRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

const DEFAULT_CATEGORIES = ['Alimentacion', 'Transporte', 'Servicios', 'Ocio', 'Salud', 'Otros'];

function isExpiredToken(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export class DetectCategories {
  constructor(private readonly deps: DetectCategoriesDeps) {}

  async execute(input: DetectCategoriesInput): Promise<void> {
    const { userId, externalId, statePayload } = input;

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      await this.sendPlaceholder(externalId, userId);
      return;
    }

    const token = await this.deps.tokenRepository.findByUserAndProvider(userId, config.provider);
    if (!token || token.revokedAt || isExpiredToken(token.accessTokenExpiresAt)) {
      await this.sendPlaceholder(externalId, userId);
      return;
    }

    let accessToken: string;
    try {
      accessToken = this.deps.tokenEncryption.decrypt(token.accessTokenEnc, token.iv);
    } catch {
      await this.sendPlaceholder(externalId, userId);
      return;
    }

    const mappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
    const categoryMapping = mappings.find((m) => m.GasttoField === 'categoria');
    if (!categoryMapping) {
      await this.sendPlaceholder(externalId, userId);
      return;
    }

    const spreadsheetPort = this.deps.spreadsheetPortFactory.create(accessToken);
    const reader = new SpreadsheetCategoryReader(spreadsheetPort);

    let categories: string[];
    try {
      categories = await reader.readCategories(
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
  }

  private async sendPlaceholder(externalId: string, userId: string): Promise<void> {
    await this.deps.messagingPort.sendMessage(externalId, onboardingCopies.onboardingPlaceholder());
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: { categories: DEFAULT_CATEGORIES.map((c) => c.toLowerCase()) },
    });
  }
}
