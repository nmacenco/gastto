// LAYER: Application
// Use case: apply parent-aware category vocabulary changes and return the
// complete proposal for re-confirmation.

import type {
  ISpreadsheetConfigRepository,
  ICategoryVocabularyRepository,
} from '../../../domain/ports/repositories';
import type { CategoryModificationParserPort } from '../../../domain/ports/categoryModificationParser';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { Category } from '../../../domain/entities/Category';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { DomainValidationError } from '../../../domain/errors/DomainValidationError';
import { onboardingCopies } from '../../copies/onboarding.copies';
import {
  parseCategoryOnboardingState,
  serializeCategoryOnboardingState,
  type CategoryOnboardingState,
} from '../../dtos/CategoryOnboardingState';

export interface ModifyCategoryVocabularyInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  rawMessage: string;
  statePayload: Record<string, unknown> | null;
}

export interface ModifyCategoryVocabularyOutput {
  categories: string[];
  state: CategoryOnboardingState;
  message: string;
}

export interface ModifyCategoryVocabularyDeps {
  categoryModificationParser: CategoryModificationParserPort;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

type ParentResolution =
  | { kind: 'found'; category: Category }
  | { kind: 'not-found' }
  | { kind: 'ambiguous'; candidates: Category[] };

const EMPTY_STATE: CategoryOnboardingState = {
  categories: [],
  orphanSubcategories: [],
  subcategoryColumnMapped: false,
};

export class ModifyCategoryVocabulary {
  constructor(private readonly deps: ModifyCategoryVocabularyDeps) {}

  async execute(input: ModifyCategoryVocabularyInput): Promise<ModifyCategoryVocabularyOutput> {
    const { userId, externalId, rawMessage, statePayload } = input;
    const payloadState = parseCategoryOnboardingState(statePayload);

    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) {
      const state = payloadState ?? EMPTY_STATE;
      const message = onboardingCopies.reconnectAccount();
      await this.deps.messagingPort.sendMessage(externalId, message);
      await this.deps.transitionState.execute({
        userId,
        targetState: 'ONBOARDING_START',
        payload: { promptShown: true },
      });
      return { categories: state.categories.map((category) => category.name), state, message };
    }

    const intent = await this.deps.categoryModificationParser.parse(rawMessage);
    let vocabulary = await this.deps.categoryVocabularyRepository.findBySpreadsheetId(config.id);
    if (!vocabulary) vocabulary = this.rebuildVocabulary(config.id, payloadState);

    const currentState = this.toState(vocabulary, payloadState);
    if (intent.kind === 'unknown') {
      return this.respond(input, currentState, this.unknownPrompt(currentState));
    }

    try {
      if (intent.kind === 'add') {
        vocabulary.addCategory(intent.name);
      } else if (intent.kind === 'remove') {
        const resolution = this.resolveParent(vocabulary, intent.name);
        if (resolution.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.name, resolution);
        }
        vocabulary.removeCategory(resolution.category.id);
      } else if (intent.kind === 'rename') {
        const resolution = this.resolveParent(vocabulary, intent.from);
        if (resolution.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.from, resolution);
        }
        vocabulary.renameCategory(resolution.category.id, intent.to);
      } else if (intent.kind === 'add-subcategory') {
        const resolution = this.resolveParent(vocabulary, intent.parent);
        if (resolution.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.parent, resolution);
        }
        vocabulary.addSubcategory(resolution.category.id, intent.name);
      } else if (intent.kind === 'rename-subcategory') {
        const resolution = this.resolveParent(vocabulary, intent.parent);
        if (resolution.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.parent, resolution);
        }
        const child = vocabulary.findSubcategory(resolution.category.id, intent.from);
        if (!child) {
          return this.respond(
            input,
            currentState,
            onboardingCopies.hierarchyChildNotFound(intent.from, intent.parent, currentState),
          );
        }
        vocabulary.renameSubcategory(child.id, intent.to);
      } else if (intent.kind === 'move-subcategory') {
        const source = this.resolveParent(vocabulary, intent.fromParent);
        if (source.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.fromParent, source);
        }
        const target = this.resolveParent(vocabulary, intent.toParent);
        if (target.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.toParent, target);
        }
        const child = vocabulary.findSubcategory(source.category.id, intent.name);
        if (!child) {
          return this.respond(
            input,
            currentState,
            onboardingCopies.hierarchyChildNotFound(intent.name, intent.fromParent, currentState),
          );
        }
        vocabulary.moveSubcategory(child.id, target.category.id);
      } else if (intent.kind === 'remove-subcategory') {
        const resolution = this.resolveParent(vocabulary, intent.parent);
        if (resolution.kind !== 'found') {
          return this.respondForParentResolution(input, currentState, intent.parent, resolution);
        }
        const child = vocabulary.findSubcategory(resolution.category.id, intent.name);
        if (!child) {
          return this.respond(
            input,
            currentState,
            onboardingCopies.hierarchyChildNotFound(intent.name, intent.parent, currentState),
          );
        }
        vocabulary.removeSubcategory(child.id);
      }
    } catch (error) {
      const message =
        error instanceof DomainValidationError
          ? this.validationErrorPrompt(error.message, currentState)
          : this.updatedPrompt(currentState);
      return this.respond(input, currentState, message);
    }

    await this.deps.categoryVocabularyRepository.save(vocabulary);
    const updatedState = this.toState(vocabulary, payloadState);
    return this.respond(input, updatedState, this.updatedPrompt(updatedState));
  }

  private rebuildVocabulary(
    spreadsheetId: string,
    state: CategoryOnboardingState | null,
  ): CategoryVocabulary {
    const vocabulary = new CategoryVocabulary(spreadsheetId);
    if (!state) return vocabulary;

    for (const categoryNode of state.categories) {
      const category = vocabulary.addCategory(categoryNode.name);
      for (const child of categoryNode.subcategories) {
        vocabulary.addSubcategory(category.id, child);
      }
    }
    return vocabulary;
  }

  private resolveParent(vocabulary: CategoryVocabulary, name: string): ParentResolution {
    const normalizedName = name.trim().toLowerCase();
    const candidates = vocabulary
      .getCategories()
      .filter((category) => category.normalizedName === normalizedName);
    if (candidates.length === 0) return { kind: 'not-found' };
    if (candidates.length > 1) return { kind: 'ambiguous', candidates: [...candidates] };
    return { kind: 'found', category: candidates[0]! };
  }

  private toState(
    vocabulary: CategoryVocabulary,
    previousState: CategoryOnboardingState | null,
  ): CategoryOnboardingState {
    return {
      categories: vocabulary.getCategories().map((category) => ({
        name: category.name,
        subcategories: vocabulary
          .getSubcategories(category.id)
          .map((subcategory) => subcategory.name),
      })),
      orphanSubcategories: [...(previousState?.orphanSubcategories ?? [])],
      subcategoryColumnMapped: previousState?.subcategoryColumnMapped ?? false,
    };
  }

  private updatedPrompt(state: CategoryOnboardingState): string {
    return this.hasHierarchy(state)
      ? onboardingCopies.hierarchyUpdatedPrompt(state)
      : onboardingCopies.categoryUpdatedPrompt(state.categories.map((category) => category.name));
  }

  private unknownPrompt(state: CategoryOnboardingState): string {
    return this.hasHierarchy(state)
      ? onboardingCopies.hierarchyUpdateGuidance(state)
      : onboardingCopies.categoryUpdatedPrompt(state.categories.map((category) => category.name));
  }

  private validationErrorPrompt(errorMessage: string, state: CategoryOnboardingState): string {
    return this.hasHierarchy(state)
      ? onboardingCopies.hierarchyDuplicateOrCollision(errorMessage, state)
      : onboardingCopies.categoryUpdateError(
          errorMessage,
          state.categories.map((category) => category.name),
        );
  }

  private hasHierarchy(state: CategoryOnboardingState): boolean {
    return (
      state.subcategoryColumnMapped ||
      state.categories.some((category) => category.subcategories.length > 0)
    );
  }

  private respondForParentResolution(
    input: ModifyCategoryVocabularyInput,
    state: CategoryOnboardingState,
    requestedParent: string,
    resolution: Exclude<ParentResolution, { kind: 'found' }>,
  ): Promise<ModifyCategoryVocabularyOutput> {
    const message =
      resolution.kind === 'ambiguous'
        ? onboardingCopies.hierarchyParentAmbiguous(
            requestedParent,
            resolution.candidates.map((candidate) => candidate.name),
            state,
          )
        : onboardingCopies.hierarchyParentNotFound(requestedParent, state);
    return this.respond(input, state, message);
  }

  private async respond(
    input: ModifyCategoryVocabularyInput,
    state: CategoryOnboardingState,
    message: string,
  ): Promise<ModifyCategoryVocabularyOutput> {
    await this.deps.messagingPort.sendMessage(input.externalId, message);
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: serializeCategoryOnboardingState(state, input.statePayload),
    });
    return { categories: state.categories.map((category) => category.name), state, message };
  }
}
