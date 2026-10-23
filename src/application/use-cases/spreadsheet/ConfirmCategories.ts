// LAYER: Application
// Use case: atomically persist the reviewed category hierarchy before
// finalizing onboarding.

import type {
  ICategoryVocabularyRepository,
  ISpreadsheetConfigRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import { onboardingCopies } from '../../copies/onboarding.copies';
import {
  parseCategoryOnboardingState,
  type CategoryOnboardingState,
} from '../../dtos/CategoryOnboardingState';

export interface ConfirmCategoriesInput {
  userId: string;
  externalId: string;
  channel: 'telegram' | 'whatsapp';
  statePayload: Record<string, unknown> | null;
}

export interface ConfirmCategoriesOutput {
  nextState: FsmState;
  message: string;
}

export interface ConfirmCategoriesDeps {
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
  userRepository: IUserRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
}

export class ConfirmCategories {
  constructor(private readonly deps: ConfirmCategoriesDeps) {}

  async execute(input: ConfirmCategoriesInput): Promise<ConfirmCategoriesOutput> {
    const { userId, externalId, statePayload } = input;
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) return this.handleReconnect(externalId, userId);

    const state = parseCategoryOnboardingState(statePayload);
    if (!state || state.categories.length === 0) {
      return this.handleInvalidProposal(input);
    }

    const persisted = await this.deps.categoryVocabularyRepository.findBySpreadsheetId(config.id);
    const vocabulary = this.reconcileHierarchy(
      persisted ?? new CategoryVocabulary(config.id),
      state,
    );

    await this.deps.categoryVocabularyRepository.save(vocabulary);

    if (!config.categoriesConfirmedAt) {
      await this.deps.spreadsheetConfigRepository.updateCategoriesConfirmed(config.id);
    }

    await this.deps.userRepository.updateStatus(userId, 'active');
    await this.deps.transitionState.execute({
      userId,
      targetState: 'IDLE',
      payload: null,
      expiresAt: null,
    });

    const message = onboardingCopies.onboardingComplete();
    await this.deps.messagingPort.sendMessage(externalId, message);
    return { nextState: 'IDLE', message };
  }

  private reconcileHierarchy(
    vocabulary: CategoryVocabulary,
    state: CategoryOnboardingState,
  ): CategoryVocabulary {
    const desiredChildren = new Map(
      state.categories.map((category) => [
        this.normalizeName(category.name),
        new Set(category.subcategories.map((child) => this.normalizeName(child))),
      ]),
    );

    for (const categoryNode of state.categories) {
      const normalizedCategoryName = this.normalizeName(categoryNode.name);
      const existingCategory = vocabulary
        .getCategories()
        .find((category) => category.normalizedName === normalizedCategoryName);
      if (existingCategory) {
        if (existingCategory.name !== categoryNode.name) {
          vocabulary.renameCategory(existingCategory.id, categoryNode.name);
        }
      } else {
        vocabulary.addCategory(categoryNode.name);
      }
    }

    const desiredChildIds = new Set<string>();
    for (const categoryNode of state.categories) {
      const category = vocabulary
        .getCategories()
        .find((candidate) => candidate.normalizedName === this.normalizeName(categoryNode.name));
      if (!category) continue;

      for (const childName of categoryNode.subcategories) {
        const normalizedChildName = this.normalizeName(childName);
        let child = vocabulary.findSubcategory(category.id, childName);

        if (!child) {
          const movableCandidates = vocabulary
            .getSubcategories()
            .filter(
              (candidate) =>
                candidate.normalizedName === normalizedChildName &&
                !this.isDesiredCurrentRelationship(
                  vocabulary,
                  candidate.categoryId,
                  candidate.normalizedName,
                  desiredChildren,
                ),
            );
          if (movableCandidates.length === 1) {
            child = vocabulary.moveSubcategory(movableCandidates[0]!.id, category.id);
          } else {
            child = vocabulary.addSubcategory(category.id, childName);
          }
        } else if (child.name !== childName) {
          child = vocabulary.renameSubcategory(child.id, childName);
        }

        desiredChildIds.add(child.id);
      }
    }

    for (const child of vocabulary.getSubcategories()) {
      if (!desiredChildIds.has(child.id)) vocabulary.removeSubcategory(child.id);
    }

    for (const category of vocabulary.getCategories()) {
      if (!desiredChildren.has(category.normalizedName)) {
        vocabulary.removeCategory(category.id);
      }
    }

    return vocabulary;
  }

  private isDesiredCurrentRelationship(
    vocabulary: CategoryVocabulary,
    categoryId: string,
    normalizedChildName: string,
    desiredChildren: ReadonlyMap<string, ReadonlySet<string>>,
  ): boolean {
    const category = vocabulary.getCategories().find((candidate) => candidate.id === categoryId);
    return (
      category !== undefined &&
      desiredChildren.get(category.normalizedName)?.has(normalizedChildName) === true
    );
  }

  private normalizeName(name: string): string {
    return name.trim().toLowerCase();
  }

  private async handleInvalidProposal(
    input: ConfirmCategoriesInput,
  ): Promise<ConfirmCategoriesOutput> {
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'ONBOARDING_CATEGORIES',
      payload: null,
    });
    const message = onboardingCopies.categoryProposalUnavailable();
    await this.deps.messagingPort.sendMessage(input.externalId, message);
    return { nextState: 'ONBOARDING_CATEGORIES', message };
  }

  private async handleReconnect(
    externalId: string,
    userId: string,
  ): Promise<ConfirmCategoriesOutput> {
    const message = onboardingCopies.reconnectAccount();
    await this.deps.messagingPort.sendMessage(externalId, message);
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    return { nextState: 'ONBOARDING_START', message };
  }
}
