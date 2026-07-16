// LAYER: Application
// Use case: interpret natural-language instructions to add or rename
// categories in the user's vocabulary. Returns the updated list for
// re-confirmation so the user can review changes before finalizing.

import type {
  ISpreadsheetConfigRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { CategoryModificationParserPort } from '../../../domain/ports/categoryModificationParser';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { DomainValidationError } from '../../../domain/errors/DomainValidationError';
import { onboardingCopies } from '../../copies/onboarding.copies';

export interface ModifyCategoryVocabularyInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  rawMessage: string;
  statePayload: Record<string, unknown> | null;
}

export interface ModifyCategoryVocabularyOutput {
  categories: string[];
  message: string;
}

export interface ModifyCategoryVocabularyDeps {
  categoryModificationParser: CategoryModificationParserPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

export class ModifyCategoryVocabulary {
  constructor(private readonly deps: ModifyCategoryVocabularyDeps) {}

  async execute(input: ModifyCategoryVocabularyInput): Promise<ModifyCategoryVocabularyOutput> {
    const { userId, externalId, rawMessage, statePayload } = input;

    const currentCategories = this.extractCategoriesFromPayload(statePayload);

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      const message = onboardingCopies.reconnectAccount();
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      return { categories: currentCategories, message };
    }

    const intent = await this.deps.categoryModificationParser.parse(rawMessage);

    let vocabulary = await this.deps.categoryVocabularyRepository.findBySpreadsheetId(config.id);
    if (!vocabulary) {
      vocabulary = new CategoryVocabulary(config.id);
      for (const cat of currentCategories) {
        try {
          vocabulary.addCategory(cat);
        } catch {
          // Ignore duplicates when rebuilding from payload
        }
      }
    }

    if (intent.kind === 'unknown') {
      const categories = this.toNameList(vocabulary);
      const message = onboardingCopies.categoryUpdatedPrompt(categories);
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: { ...statePayload, categories },
      });
      return { categories, message };
    }

    try {
      if (intent.kind === 'add') {
        vocabulary.addCategory(intent.name);
      } else if (intent.kind === 'rename') {
        const fromNormalized = intent.from.toLowerCase().trim();
        const target = vocabulary.getCategories().find((c) => c.normalizedName === fromNormalized);
        if (!target) {
          const categories = this.toNameList(vocabulary);
          const message = onboardingCopies.categoryNotFoundForRename(intent.from, categories);
          await this.deps.messagingPort.sendMessage(externalId, message);
          await this.deps.transitionState.execute({
            userId,
            targetState: 'ONBOARDING_CATEGORIES',
            payload: { ...statePayload, categories },
          });
          return { categories, message };
        }
        vocabulary.renameCategory(target.id, intent.to);
      }
    } catch (err) {
      const categories = this.toNameList(vocabulary);
      const message =
        err instanceof DomainValidationError
          ? onboardingCopies.categoryUpdateError(err.message, categories)
          : onboardingCopies.categoryUpdatedPrompt(categories);
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: { ...statePayload, categories },
      });
      return { categories, message };
    }

    await this.deps.categoryVocabularyRepository.save(vocabulary);

    const categories = this.toNameList(vocabulary);
    const message = onboardingCopies.categoryUpdatedPrompt(categories);
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: { ...statePayload, categories },
    });

    return { categories, message };
  }

  private extractCategoriesFromPayload(
    statePayload: Record<string, unknown> | null,
  ): string[] {
    const cats = statePayload?.categories;
    if (Array.isArray(cats)) {
      const result: string[] = [];
      for (const c of cats) {
        if (typeof c === 'string') result.push(c);
      }
      return result;
    }
    return [];
  }

  private toNameList(vocabulary: CategoryVocabulary): string[] {
    return vocabulary.getCategories().map((c) => c.name);
  }
}
