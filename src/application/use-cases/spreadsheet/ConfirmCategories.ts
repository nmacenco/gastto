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
    const config = await this.deps.spreadsheetConfigRepository.findByUserId(userId);
    if (!config) return this.handleReconnect(externalId, userId);

    const state = parseCategoryOnboardingState(statePayload);
    if (!state || state.categories.length === 0) {
      return this.handleInvalidProposal(input);
    }

    if (
      this.deps.detectPaymentMethods &&
      this.deps.columnMappingRepository &&
      this.deps.onboardingCommit
    ) {
      if (statePayload?.paymentReview !== true) {
        try {
          const mappings = await this.deps.columnMappingRepository.findBySpreadsheetId(config.id);
          const proposal = await this.deps.detectPaymentMethods.execute({
            userId,
            provider: config.provider,
            fileId: config.fileId,
            sheetName: config.sheetName,
            mappings: mappings.map((item) => ({
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
              paymentReview: true,
              paymentMethods: proposal.names,
              paymentColumnMapped: proposal.columnMapped,
            },
          });
          const message = this.paymentPrompt(proposal.names, proposal.columnMapped);
          await this.deps.messagingPort.sendMessage(externalId, message);
          return { nextState: 'ONBOARDING_CATEGORIES', message };
        } catch {
          const message =
            'No pudimos leer los medios de pago. Escribí confirmar para reintentar o cancelar.';
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
        this.paymentPrompt(paymentMethods, input.statePayload.paymentColumnMapped === true),
      );
    } catch (error) {
      if (!(error instanceof DomainValidationError)) throw error;
      await this.deps.messagingPort.sendMessage(
        input.externalId,
        `${error.message}\n${this.paymentPrompt(names, input.statePayload.paymentColumnMapped === true)}`,
      );
    }
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

  private paymentPrompt(names: string[], mapped: boolean): string {
    return `Revisá los medios de pago:\n${names.map((name) => `• ${name}`).join('\n') || '(sin medios de pago)'}${mapped ? '' : '\nSin columna mapeada: se guardarán solo en Gastto.'}\nEscribí confirmar para activar toda la configuración, agregar Nombre, renombrar Nombre a Otro, quitar Nombre o cancelar.`;
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
