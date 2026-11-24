import { presentCategoryProposal } from '../../services/PresentCategoryProposal';
import type { DetectCategories } from './DetectCategories';
import type { SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import type { Logger } from 'pino';
import {
  assertCurrentOnboardingProposal,
  captureConfirmedOnboardingContext,
  onboardingContextIssue,
  mappingRecoveryPayload,
} from '../../services/ConfirmedOnboardingContext';
import { StaleConversationStateError } from '../../../domain/errors/StaleConversationStateError';
import { paymentSetupCopies } from '../../copies/payment-setup.copies';
// LAYER: Application
// Use case: atomically persist the reviewed category hierarchy before
// finalizing onboarding.

import type {
  ICategoryVocabularyRepository,
  IColumnMappingRepository,
  ISpreadsheetConfigRepository,
  IUserRepository,
} from '../../../domain/ports/repositories';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type { FsmState } from '../../../domain/entities/ConversationState';
import { CategoryVocabulary } from '../../../domain/entities/CategoryVocabulary';
import {
  PaymentMethodCatalog,
  normalizePaymentMethodName,
} from '../../../domain/entities/PaymentMethodCatalog';
import { DomainValidationError } from '../../../domain/errors/DomainValidationError';
import type { DetectPaymentMethods } from './DetectPaymentMethods';
import type { OnboardingVocabularyCommit } from '../../ports/OnboardingVocabularyCommit';
import { onboardingCopies } from '../../copies/onboarding.copies';
import {
  parseCategoryOnboardingState,
  categoryProposalFingerprint,
  mayBeLegacyPlaceholder,
  isCategoryProposalPresented,
  isCategoryProposalAccepted,
  parseCategoryProposalMetadata,
  serializeCategoryOnboardingState,
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
  logger?: Pick<Logger, 'error'>;
  detectCategories?: Pick<DetectCategories, 'execute'>;
  spreadsheetConfigRepository: ISpreadsheetConfigRepository;
  categoryVocabularyRepository: ICategoryVocabularyRepository;
  userRepository: IUserRepository;
  messagingPort: MessagingOutputPort;
  transitionState: TransitionConversationState;
  columnMappingRepository?: IColumnMappingRepository;
  detectPaymentMethods?: DetectPaymentMethods;
  onboardingCommit?: OnboardingVocabularyCommit;
}

export class ConfirmCategories {
  constructor(private readonly deps: ConfirmCategoriesDeps) {}

  async execute(input: ConfirmCategoriesInput): Promise<ConfirmCategoriesOutput> {
    const { userId, externalId, statePayload } = input;
    assertCurrentOnboardingProposal(this.deps.transitionState, userId, input.statePayload);
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) return this.handleReconnect(externalId, userId);

    const mappings = this.deps.columnMappingRepository
      ? await this.deps.columnMappingRepository.findBySpreadsheetId(config.id)
      : undefined;
    const issue = onboardingContextIssue(userId, config, statePayload, mappings);
    if (issue) return this.recoverMapping(input, config, issue);

    const state = parseCategoryOnboardingState(statePayload);
    if (!state || state.categories.length === 0) {
      return this.handleInvalidProposal(input);
    }

    if (statePayload?.confirmedMappings === undefined) {
      const identifiedDraft = statePayload?.categoryDraft;
      const matchingDestination =
        statePayload?.spreadsheetId === config.id ||
        (statePayload?.provider === config.provider &&
          statePayload?.fileId === config.fileId &&
          statePayload?.sheetName === config.sheetName);
      const context =
        (identifiedDraft || !mayBeLegacyPlaceholder(state)) && matchingDestination && mappings
          ? captureConfirmedOnboardingContext(config, mappings, statePayload)
          : null;
      if (context) return this.represent(input, state, context);
      // Placeholder defaults have no identified draft. Read the real columns again.
      if (this.deps.detectCategories) {
        const detected = await this.deps.detectCategories.execute(input);
        return {
          nextState: detected.kind === 'recovery' ? detected.nextState : 'ONBOARDING_CATEGORIES',
          message: detected.message,
        };
      }
      return this.recoverMapping(input, config, 'legacy_context_missing');
    }
    const observedCategoryState = this.deps.transitionState.currentState(userId);
    if (observedCategoryState && observedCategoryState.currentState !== 'ONBOARDING_CATEGORIES') {
      throw new StaleConversationStateError({ status: 'stale' });
    }
    const observedPayload = observedCategoryState?.statePayload ?? null;
    const matchingPresentation =
      isCategoryProposalPresented(observedPayload) &&
      categoryProposalFingerprint(observedPayload!) === categoryProposalFingerprint(statePayload);
    if (
      !matchingPresentation ||
      !isCategoryProposalPresented(statePayload) ||
      (statePayload.paymentReview === true &&
        (!isCategoryProposalAccepted(statePayload) || !isCategoryProposalAccepted(observedPayload)))
    ) {
      return this.represent(input, state, statePayload);
    }

    if (
      this.deps.detectPaymentMethods &&
      this.deps.columnMappingRepository &&
      this.deps.onboardingCommit
    ) {
      if (statePayload?.paymentReview !== true) {
        try {
          const proposal = await this.deps.detectPaymentMethods.execute({
            userId,
            provider: config.provider,
            fileId: config.fileId,
            sheetName: config.sheetName,
            mappings: mappings!.map((item) => ({
              field: item.GasttoField,
              columnIndex: item.columnIndex,
            })),
            headerRowIndex: config.headerRowIndex ?? 1,
          });
          await this.deps.transitionState.execute({
            userId,
            targetState: 'ONBOARDING_CATEGORIES',
            payload: {
              ...serializeCategoryOnboardingState(state, statePayload),
              categoryAcceptance: {
                proposalId: statePayload.categoryProposalId,
                fingerprint:
                  parseCategoryProposalMetadata(statePayload)!.categoryPresentation!.fingerprint,
              },
              paymentReview: true,
              paymentMethods: proposal.names,
              paymentColumnMapped: proposal.columnMapped,
            },
          });
          const message = paymentSetupCopies.onboardingReview(
            proposal.names,
            proposal.columnMapped,
          );
          await this.deps.messagingPort.sendMessage(externalId, message);
          return { nextState: 'ONBOARDING_CATEGORIES', message };
        } catch (error) {
          if (error instanceof StaleConversationStateError) throw error;
          const message = paymentSetupCopies.readFailure();
          await this.deps.messagingPort.sendMessage(externalId, message);
          return { nextState: 'ONBOARDING_CATEGORIES', message };
        }
      }
      const paymentMethods = this.paymentNames(statePayload);
      if (!paymentMethods) return this.handleInvalidProposal(input);
      const observed = this.deps.transitionState.currentState(userId);
      if (!observed) return this.handleInvalidProposal(input);
      const result = await this.deps.onboardingCommit.execute({
        userId,
        expected: this.deps.transitionState.precondition(observed),
        sourceConfigId: config.id,
        categories: state.categories,
        paymentMethods,
        ...(this.categoryDraft(statePayload)
          ? { categoryDraft: this.categoryDraft(statePayload)! }
          : {}),
      });
      const message =
        result === 'committed'
          ? onboardingCopies.onboardingComplete()
          : 'La propuesta cambió o venció. Revisá la configuración antes de confirmar de nuevo.';
      await this.deps.messagingPort.sendMessage(externalId, message);
      return { nextState: result === 'committed' ? 'IDLE' : 'ONBOARDING_CATEGORIES', message };
    }

    this.deps.transitionState.assertExecutionIsValid(userId);
    const compatibilityState = this.deps.transitionState.currentState(userId);
    if (
      !compatibilityState ||
      compatibilityState.currentState !== 'ONBOARDING_CATEGORIES' ||
      !isCategoryProposalPresented(compatibilityState.statePayload) ||
      categoryProposalFingerprint(compatibilityState.statePayload!) !==
        categoryProposalFingerprint(statePayload)
    ) {
      throw new StaleConversationStateError({ status: 'stale' });
    }
    if (compatibilityState?.expiresAt && compatibilityState.expiresAt.getTime() <= Date.now()) {
      throw new StaleConversationStateError({ status: 'expired' });
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

  async replyPayment(input: ConfirmCategoriesInput & { rawMessage: string }): Promise<void> {
    if (input.statePayload?.paymentReview !== true) return;
    assertCurrentOnboardingProposal(this.deps.transitionState, input.userId, input.statePayload);
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(input.userId);
    if (!config) {
      await this.handleReconnect(input.externalId, input.userId);
      return;
    }
    const mappings = this.deps.columnMappingRepository
      ? await this.deps.columnMappingRepository.findBySpreadsheetId(config.id)
      : undefined;
    const issue = onboardingContextIssue(input.userId, config, input.statePayload, mappings);
    if (issue) {
      await this.recoverMapping(input, config, issue);
      return;
    }
    const observedPayload =
      this.deps.transitionState.currentState(input.userId)?.statePayload ?? null;
    if (
      !isCategoryProposalAccepted(input.statePayload) ||
      !isCategoryProposalAccepted(observedPayload) ||
      categoryProposalFingerprint(input.statePayload) !==
        categoryProposalFingerprint(observedPayload!)
    ) {
      await this.execute(input);
      return;
    }
    const names = this.paymentNames(input.statePayload);
    if (!names) return;
    const catalog = new PaymentMethodCatalog('onboarding-proposal');
    for (const name of names) catalog.add(name);
    const command = input.rawMessage.trim();
    const add = command.match(
      /^(?:agregar|agrega|añadir|añade)\s+(?:medio\s+de\s+pago\s+)?(.+)$/iu,
    );
    const rename = command.match(/^(?:renombrar|renombra)\s+(.+?)\s+(?:a|por)\s+(.+)$/iu);
    const remove = command.match(/^(?:quitar|quita|eliminar|elimina)\s+(.+)$/iu);
    const find = (name: string) =>
      catalog.getActive().find((item) => item.normalizedName === normalizePaymentMethodName(name));
    try {
      if (add) catalog.add(add[1]!);
      else if (rename) {
        const item = find(rename[1]!);
        if (!item) throw new DomainValidationError('Medio de pago no encontrado');
        catalog.rename(item.id, rename[2]!);
      } else if (remove) {
        const item = find(remove[1]!);
        if (!item) throw new DomainValidationError('Medio de pago no encontrado');
        catalog.deactivate(item.id);
      }
      const paymentMethods = catalog.getActive().map((item) => item.name);
      await this.deps.transitionState.execute({
        userId: input.userId,
        targetState: 'ONBOARDING_CATEGORIES',
        payload: { ...input.statePayload, paymentMethods },
      });
      await this.deps.messagingPort.sendMessage(
        input.externalId,
        paymentSetupCopies.onboardingReview(
          paymentMethods,
          input.statePayload.paymentColumnMapped === true,
        ),
      );
    } catch (error) {
      if (!(error instanceof DomainValidationError)) throw error;
      await this.deps.messagingPort.sendMessage(
        input.externalId,
        `${error.message}\n${paymentSetupCopies.onboardingReview(names, input.statePayload.paymentColumnMapped === true)}`,
      );
    }
  }

  private async represent(
    input: ConfirmCategoriesInput,
    state: CategoryOnboardingState,
    payload: Record<string, unknown>,
  ): Promise<ConfirmCategoriesOutput> {
    const message =
      onboardingCopies.categoryReviewRequired() +
      '\n\n' +
      onboardingCopies.categoryHierarchyConfirmationPrompt(
        state.categories,
        state.orphanSubcategories,
      );
    await presentCategoryProposal(this.deps, {
      userId: input.userId,
      externalId: input.externalId,
      payload: serializeCategoryOnboardingState(state, payload),
      message,
    });
    return { nextState: 'ONBOARDING_CATEGORIES', message };
  }

  private async recoverMapping(
    input: ConfirmCategoriesInput,
    config: SpreadsheetConfig,
    code: string,
  ): Promise<ConfirmCategoriesOutput> {
    this.deps.logger?.error({
      msg: 'Inconsistent onboarding context',
      endpoint: 'ConfirmCategories',
      code,
      userId: input.userId,
      configId: config.id,
      proposalId:
        typeof input.statePayload?.proposalId === 'string'
          ? input.statePayload.proposalId
          : undefined,
    });
    const message = onboardingCopies.categoryMappingRecovery();
    await this.deps.transitionState.execute({
      userId: input.userId,
      targetState: 'ONBOARDING_MAPPING',
      payload: mappingRecoveryPayload(config),
    });
    await this.deps.messagingPort.sendMessage(input.externalId, message);
    return { nextState: 'ONBOARDING_MAPPING', message };
  }

  private paymentNames(payload: Record<string, unknown>): string[] | null {
    return Array.isArray(payload.paymentMethods) &&
      payload.paymentMethods.every((item) => typeof item === 'string')
      ? payload.paymentMethods
      : null;
  }

  private categoryDraft(
    payload: Record<string, unknown>,
  ): Parameters<OnboardingVocabularyCommit['execute']>[0]['categoryDraft'] {
    const draft = payload.categoryDraft;
    if (
      !draft ||
      typeof draft !== 'object' ||
      !('categories' in draft) ||
      !('subcategories' in draft)
    )
      return undefined;
    if (!Array.isArray(draft.categories) || !Array.isArray(draft.subcategories)) return undefined;
    return draft as NonNullable<
      Parameters<OnboardingVocabularyCommit['execute']>[0]['categoryDraft']
    >;
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
    await this.deps.transitionState.execute({
      userId,
      targetState: 'ONBOARDING_START',
      payload: { promptShown: true },
    });
    await this.deps.messagingPort.sendMessage(externalId, message);
    return { nextState: 'ONBOARDING_START', message };
  }
}
