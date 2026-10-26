import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ConversationState } from '../../../domain/entities/ConversationState';
import { DomainValidationError } from '../../../domain/errors/DomainValidationError';
import {
  PaymentMethodCatalog,
  normalizePaymentMethodName,
} from '../../../domain/entities/PaymentMethodCatalog';
import type {
  IColumnMappingRepository,
  ISpreadsheetConfigRepository,
} from '../../../domain/ports/repositories';
import type { CategoryModificationParserPort } from '../../../domain/ports/categoryModificationParser';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';
import type {
  SettingsVocabularyCommit,
  PaymentSnapshot,
  VocabularySnapshot,
} from '../../ports/SettingsVocabularyCommit';
import { applyCategoryDraftOperation } from '../../services/applyCategoryDraftOperation';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { DetectPaymentMethods } from './DetectPaymentMethods';

const category = z.object({
  id: z.string().uuid(),
  name: z.string(),
  normalizedName: z.string(),
  isActive: z.boolean(),
});
const subcategory = category.extend({ categoryId: z.string().uuid() });
const snapshot = z.object({ categories: z.array(category), subcategories: z.array(subcategory) });
const menu = z.object({ screen: z.literal('menu'), flowId: z.string().min(1) });
const categories = z.object({
  screen: z.literal('categories'),
  flowId: z.string().uuid(),
  sourceConfigId: z.string().uuid(),
  subcategoryColumnMapped: z.boolean(),
  baseline: snapshot,
  draft: snapshot,
});
const paymentMethod = z.object({
  id: z.string().uuid(),
  name: z.string(),
  normalizedName: z.string(),
  isActive: z.boolean(),
});
const payments = z.object({
  screen: z.literal('payment_methods'),
  flowId: z.string().uuid(),
  sourceConfigId: z.string().uuid(),
  paymentColumnMapped: z.boolean(),
  baseline: z.object({ confirmed: z.boolean(), methods: z.array(paymentMethod) }),
  draft: z.object({ confirmed: z.boolean(), methods: z.array(paymentMethod) }),
});
export const settingsVocabularyPayload = z.discriminatedUnion('screen', [
  menu,
  categories,
  payments,
]);
export type SettingsVocabularyPayload = z.infer<typeof settingsVocabularyPayload>;

export function parseSettingsVocabularyPayload(
  value: Record<string, unknown> | null,
): SettingsVocabularyPayload | null {
  if (value && value.screen === undefined && typeof value.flowId === 'string')
    return menu.safeParse({ screen: 'menu', flowId: value.flowId }).data ?? null;
  return settingsVocabularyPayload.safeParse(value).data ?? null;
}

export class SettingsVocabularyFlow {
  constructor(
    private readonly deps: {
      configRepository: ISpreadsheetConfigRepository;
      mappingRepository: IColumnMappingRepository;
      parser: CategoryModificationParserPort;
      commit: SettingsVocabularyCommit;
      transition: TransitionConversationState;
      messaging: MessagingOutputPort;
      detectPaymentMethods?: Pick<DetectPaymentMethods, 'execute'>;
    },
  ) {}

  async start({
    state,
    externalId,
    kind,
  }: {
    state: ConversationState;
    externalId: string;
    kind: 'categories' | 'payment_methods';
  }): Promise<void> {
    const config = await this.deps.configRepository.findByUserId(state.userId);
    if (!config || !config.isActive || !config.fileId || !config.sheetName) {
      await this.deps.messaging.sendMessage(
        externalId,
        'Primero completá la configuración de una planilla y una hoja.',
      );
      return;
    }
    const mappings = await this.deps.mappingRepository.findBySpreadsheetId(config.id);
    let payload: SettingsVocabularyPayload;
    if (kind === 'categories') {
      const baseline = await this.deps.commit.load(config.id);
      payload = {
        screen: 'categories',
        flowId: randomUUID(),
        sourceConfigId: config.id,
        subcategoryColumnMapped: mappings.some((mapping) => mapping.GasttoField === 'subcategoria'),
        baseline,
        draft: structuredClone(baseline),
      };
    } else {
      const baseline = await this.deps.commit.loadPayments(config.id);
      payload = {
        screen: 'payment_methods',
        flowId: randomUUID(),
        sourceConfigId: config.id,
        paymentColumnMapped: mappings.some((mapping) => mapping.GasttoField === 'medio_pago'),
        baseline,
        draft: structuredClone(baseline),
      };
    }
    await this.deps.transition.execute({
      userId: state.userId,
      targetState: 'SETTINGS_MENU',
      payload,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      expected: this.deps.transition.precondition(state, 'unexpired'),
    });
    await this.deps.messaging.sendMessage(
      externalId,
      payload.screen === 'categories'
        ? this.render(payload.draft, payload.subcategoryColumnMapped)
        : this.renderPayments(payload.draft, payload.paymentColumnMapped),
    );
  }

  async reply({
    state,
    externalId,
    rawMessage,
  }: {
    state: ConversationState;
    externalId: string;
    rawMessage: string;
  }): Promise<void> {
    const payload = parseSettingsVocabularyPayload(state.statePayload);
    if (!payload || payload.screen === 'menu') {
      await this.deps.transition.execute({
        userId: state.userId,
        targetState: 'IDLE',
        payload: null,
        expected: this.deps.transition.precondition(state, 'unexpired'),
      });
      await this.deps.messaging.sendMessage(
        externalId,
        'El borrador no es válido. Abrí configuración de nuevo.',
      );
      return;
    }
    if (payload.screen === 'payment_methods') {
      await this.replyPayments(state, externalId, rawMessage, payload);
      return;
    }
    if (/^confirmar$/iu.test(rawMessage.trim())) {
      if (!payload.draft.categories.some((entry) => entry.isActive)) {
        await this.touch(state, payload);
        await this.deps.messaging.sendMessage(
          externalId,
          'Debe quedar al menos una categoría activa.',
        );
        return;
      }
      const outcome = await this.deps.commit.execute({
        kind: 'categories',
        userId: state.userId,
        expected: this.deps.transition.precondition(state, 'unexpired'),
        flowId: payload.flowId,
        sourceConfigId: payload.sourceConfigId,
        baseline: payload.baseline,
        draft: payload.draft,
      });
      if (outcome === 'committed')
        await this.deps.messaging.sendMessage(externalId, 'Categorías y subcategorías guardadas.');
      else {
        await this.deps.transition
          .execute({
            userId: state.userId,
            targetState: 'IDLE',
            payload: null,
            expected: this.deps.transition.precondition(state, 'unexpired'),
          })
          .catch(() => undefined);
        await this.deps.messaging.sendMessage(
          externalId,
          'El catálogo cambió o la sesión venció. Abrí configuración de nuevo.',
        );
      }
      return;
    }
    const intent = await this.deps.parser.parse(rawMessage);
    if (intent.kind === 'unknown') {
      await this.touch(state, payload);
      await this.deps.messaging.sendMessage(
        externalId,
        this.render(payload.draft, payload.subcategoryColumnMapped),
      );
      return;
    }
    try {
      const affected =
        intent.kind === 'remove'
          ? payload.draft.categories.find(
              (entry) =>
                entry.isActive && entry.normalizedName === intent.name.trim().toLowerCase(),
            )
          : null;
      const children = affected
        ? payload.draft.subcategories
            .filter((entry) => entry.isActive && entry.categoryId === affected.id)
            .map((entry) => entry.name)
        : [];
      const draft = applyCategoryDraftOperation(payload.draft, payload.sourceConfigId, intent);
      await this.deps.transition.execute({
        userId: state.userId,
        targetState: 'SETTINGS_MENU',
        payload: { ...payload, draft },
        expiresAt: new Date(Date.now() + 30 * 60_000),
        expected: this.deps.transition.precondition(state, 'unexpired'),
      });
      await this.deps.messaging.sendMessage(
        externalId,
        `${children.length ? `También se desactivarán: ${children.join(', ')}.\n` : ''}${this.render(draft, payload.subcategoryColumnMapped)}`,
      );
    } catch (error) {
      if (!(error instanceof DomainValidationError)) throw error;
      await this.touch(state, payload);
      await this.deps.messaging.sendMessage(
        externalId,
        `${error.message}\n${this.render(payload.draft, payload.subcategoryColumnMapped)}`,
      );
    }
  }

  private async touch(state: ConversationState, payload: SettingsVocabularyPayload): Promise<void> {
    await this.deps.transition.execute({
      userId: state.userId,
      targetState: 'SETTINGS_MENU',
      payload,
      expiresAt: new Date(Date.now() + 30 * 60_000),
      expected: this.deps.transition.precondition(state, 'unexpired'),
    });
  }

  private async replyPayments(
    state: ConversationState,
    externalId: string,
    rawMessage: string,
    payload: Extract<SettingsVocabularyPayload, { screen: 'payment_methods' }>,
  ): Promise<void> {
    const command = rawMessage.trim();
    if (/^detectar$/iu.test(command)) {
      if (!this.deps.detectPaymentMethods) {
        await this.deps.messaging.sendMessage(
          externalId,
          'La detección no está disponible. Podés agregar medios manualmente.',
        );
        return;
      }
      const config = await this.deps.configRepository.findByUserId(state.userId);
      if (!config || config.id !== payload.sourceConfigId) {
        await this.deps.messaging.sendMessage(
          externalId,
          'La configuración cambió. Abrí configuración de nuevo.',
        );
        return;
      }
      try {
        const mappings = await this.deps.mappingRepository.findBySpreadsheetId(config.id);
        const proposal = await this.deps.detectPaymentMethods.execute({
          userId: state.userId,
          provider: config.provider,
          fileId: config.fileId,
          sheetName: config.sheetName,
          mappings: mappings.map((item) => ({
            field: item.GasttoField,
            columnIndex: item.columnIndex,
          })),
          headerRowIndex: config.headerRowIndex ?? 1,
        });
        const catalog = new PaymentMethodCatalog(config.id, payload.draft.methods);
        for (const name of proposal.names) {
          if (
            !catalog
              .getActive()
              .some((item) => item.normalizedName === normalizePaymentMethodName(name))
          )
            catalog.add(name);
        }
        const draft = { ...payload.draft, methods: [...catalog.getMethods()] };
        await this.deps.transition.execute({
          userId: state.userId,
          targetState: 'SETTINGS_MENU',
          payload: { ...payload, draft },
          expiresAt: new Date(Date.now() + 30 * 60_000),
          expected: this.deps.transition.precondition(state, 'unexpired'),
        });
        await this.deps.messaging.sendMessage(
          externalId,
          this.renderPayments(draft, payload.paymentColumnMapped),
        );
      } catch {
        await this.deps.messaging.sendMessage(
          externalId,
          'No pudimos leer los medios de pago. Escribí detectar para reintentar o agregalos manualmente.',
        );
      }
      return;
    }
    if (/^confirmar$/iu.test(command)) {
      const outcome = await this.deps.commit.execute({
        kind: 'payment_methods',
        userId: state.userId,
        expected: this.deps.transition.precondition(state, 'unexpired'),
        flowId: payload.flowId,
        sourceConfigId: payload.sourceConfigId,
        baseline: payload.baseline,
        draft: payload.draft,
      });
      if (outcome === 'committed')
        await this.deps.messaging.sendMessage(externalId, 'Medios de pago guardados.');
      else {
        await this.deps.transition
          .execute({
            userId: state.userId,
            targetState: 'IDLE',
            payload: null,
            expected: this.deps.transition.precondition(state, 'unexpired'),
          })
          .catch(() => undefined);
        await this.deps.messaging.sendMessage(
          externalId,
          'El catálogo cambió o la sesión venció. Abrí configuración de nuevo.',
        );
      }
      return;
    }
    const add = command.match(
      /^(?:agregar|agrega|añadir|añade)\s+(?:medio\s+de\s+pago\s+)?(.+)$/iu,
    );
    const rename = command.match(/^(?:renombrar|renombra)\s+(.+?)\s+(?:a|por)\s+(.+)$/iu);
    const remove = command.match(/^(?:quitar|quita|eliminar|elimina)\s+(.+)$/iu);
    if (!add && !rename && !remove) {
      await this.touch(state, payload);
      await this.deps.messaging.sendMessage(
        externalId,
        this.renderPayments(payload.draft, payload.paymentColumnMapped),
      );
      return;
    }
    try {
      const catalog = new PaymentMethodCatalog(payload.sourceConfigId, payload.draft.methods);
      const find = (name: string) => {
        const method = catalog
          .getActive()
          .find((entry) => entry.normalizedName === normalizePaymentMethodName(name));
        if (!method) throw new DomainValidationError(`No existe el medio de pago "${name}"`);
        return method;
      };
      if (add) catalog.add(add[1]!);
      else if (rename) catalog.rename(find(rename[1]!).id, rename[2]!);
      else if (remove) catalog.deactivate(find(remove[1]!).id);
      const draft: PaymentSnapshot = {
        confirmed: payload.draft.confirmed,
        methods: [...catalog.getMethods()],
      };
      await this.deps.transition.execute({
        userId: state.userId,
        targetState: 'SETTINGS_MENU',
        payload: { ...payload, draft },
        expiresAt: new Date(Date.now() + 30 * 60_000),
        expected: this.deps.transition.precondition(state, 'unexpired'),
      });
      await this.deps.messaging.sendMessage(
        externalId,
        this.renderPayments(draft, payload.paymentColumnMapped),
      );
    } catch (error) {
      if (!(error instanceof DomainValidationError)) throw error;
      await this.touch(state, payload);
      await this.deps.messaging.sendMessage(
        externalId,
        `${error.message}\n${this.renderPayments(payload.draft, payload.paymentColumnMapped)}`,
      );
    }
  }

  renderPayments(draft: PaymentSnapshot, paymentColumnMapped = true): string {
    const methods = draft.methods
      .filter((method) => method.isActive)
      .map((method) => `• ${method.name}`);
    return `Borrador de medios de pago:\n${methods.join('\n') || '(sin medios de pago)'}${paymentColumnMapped ? '' : '\nLos medios de pago se conservarán en Gastto, pero no se escribirán en la planilla porque no hay una columna mapeada.'}\n\nEjemplos: detectar; agregar Efectivo; renombrar Efectivo a Dinero; quitar Dinero.\nEscribí confirmar para guardar este catálogo, incluso si está vacío, o cancelar para descartarlo.`;
  }

  render(draft: VocabularySnapshot, subcategoryColumnMapped = true): string {
    const lines = draft.categories
      .filter((entry) => entry.isActive)
      .map((entry) => {
        const children = draft.subcategories
          .filter((child) => child.isActive && child.categoryId === entry.id)
          .map((child) => child.name);
        return `• ${entry.name}${children.length ? `: ${children.join(', ')}` : ''}`;
      });
    return `Borrador de categorías y subcategorías:\n${lines.join('\n') || '(sin categorías activas)'}${subcategoryColumnMapped ? '' : '\nLas subcategorías se conservarán en Gastto, pero no se escribirán en la planilla porque no hay una columna mapeada.'}\n\nEjemplos: agregar categoría Comida; Comida se llama Alimentación; quitar Comida; agregar subcategoría Café a Comida; en Comida renombrar Café a Cafetería; mover Café de Comida a Ocio; quitar Café de Comida.\nEscribí confirmar para guardar todos los cambios o cancelar para descartarlos.`;
  }
}
