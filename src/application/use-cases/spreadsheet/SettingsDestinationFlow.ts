import { randomUUID } from 'node:crypto';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import type { GasttoField, SpreadsheetConfig } from '../../../domain/entities/SpreadsheetConfig';
import { SUPPORTED_GASTTO_FIELDS } from '../../../domain/entities/SpreadsheetConfig';
import type {
  ISpreadsheetConfigRepository,
  IColumnMappingRepository,
} from '../../../domain/ports/repositories';
import type { SpreadsheetPortFactory } from '../../../domain/ports/services';
import type { ValidateSpreadsheetAccessPortFactory } from '../../../domain/ports/spreadsheetAccess';
import type { HeaderDetectionPort } from '../../../domain/ports/headerDetection';
import type { ColumnInferencePort } from '../../../domain/ports/columnInference';
import type { ICategoryReaderPortFactory } from '../../../domain/ports/categoryReader';
import type { ICategoryHierarchyReaderPortFactory } from '../../../domain/ports/categoryHierarchyReader';
import type { OAuthAccessTokenProvider } from '../../services/OAuthAccessTokenService';
import type {
  SettingsConfigurationActivation,
  SettingsDestinationCandidate,
} from '../../ports/SettingsConfigurationActivation';
import type { TransitionConversationState } from '../conversation/TransitionConversationState';
import type { MessagingOutputPort } from '../../ports/output/messaging.port';

type Mapping = SettingsDestinationCandidate['mappings'][number];
type Category = SettingsDestinationCandidate['categories'][number];
type Payload = Record<string, unknown> & {
  flowId: string;
  sourceConfigId: string;
  fileId: string;
  fileName: string;
  sheetName?: string;
  proposalId?: string;
  step?: string;
  sheets?: Array<{ name: string; index: number }>;
  preview?: Array<{ index: number; values: unknown[] }>;
  headerRowIndex?: number;
  mappings?: Mapping[];
  categories?: Category[];
  accessVerifiedAt?: string;
};

export interface SettingsDestinationFlowDeps {
  configRepository: ISpreadsheetConfigRepository;
  mappingRepository: IColumnMappingRepository;
  spreadsheetPortFactory: SpreadsheetPortFactory;
  accessPortFactory: ValidateSpreadsheetAccessPortFactory;
  headerDetector: HeaderDetectionPort;
  columnInference: ColumnInferencePort;
  categoryReaderFactory: ICategoryReaderPortFactory;
  categoryHierarchyReaderFactory: ICategoryHierarchyReaderPortFactory;
  tokenService: OAuthAccessTokenProvider;
  activation: SettingsConfigurationActivation;
  transitionState: TransitionConversationState;
  messaging: MessagingOutputPort;
}

const timeoutMs = 30 * 60 * 1000;
const normalize = (value: string) =>
  value
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function cellToString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

export class SettingsDestinationFlow {
  constructor(private readonly deps: SettingsDestinationFlowDeps) {}

  async startSheet(state: ConversationState, externalId: string): Promise<void> {
    const config = await this.deps.configRepository.findByUserId(state.userId);
    if (!config || config.provider !== 'google' || !config.fileId || !config.sheetName) {
      await this.deps.messaging.sendMessage(
        externalId,
        'Primero completá la configuración de una planilla y una hoja de Google.',
      );
      return;
    }
    const token = await this.token(state.userId);
    const sheets = await this.deps.spreadsheetPortFactory.create(token).listSheets(config.fileId);
    if (!sheets.length) {
      await this.deps.messaging.sendMessage(
        externalId,
        'No encontramos hojas en la planilla actual.',
      );
      return;
    }
    const payload: Payload = {
      flowId: randomUUID(),
      sourceConfigId: config.id,
      fileId: config.fileId,
      fileName: config.fileName,
      sheets: sheets.map(({ name, index }) => ({ name, index })),
    };
    await this.move(state, 'SETTINGS_SHEET', payload);
    await this.deps.messaging.sendMessage(externalId, this.sheetPrompt(sheets));
  }

  async reply(state: ConversationState, rawMessage: string, externalId: string): Promise<void> {
    const payload = this.payload(state);
    if (!payload) return;
    if (normalize(rawMessage) === 'cancelar') {
      await this.move(state, 'IDLE', null);
      await this.deps.messaging.sendMessage(
        externalId,
        'Saliste de configuración. Tu hoja anterior sigue activa.',
      );
      return;
    }
    switch (state.currentState) {
      case 'SETTINGS_SHEET':
        await this.selectSheet(state, payload, rawMessage, externalId);
        break;
      case 'SETTINGS_MAPPING':
        await this.reviewMapping(state, payload, rawMessage, externalId);
        break;
      case 'SETTINGS_CATEGORIES':
        await this.reviewCategories(state, payload, rawMessage, externalId);
        break;
    }
  }

  private async selectSheet(
    state: ConversationState,
    payload: Payload,
    reply: string,
    externalId: string,
  ): Promise<void> {
    const sheets = payload.sheets ?? [];
    const index = Number(reply.trim());
    const sheet = Number.isInteger(index) ? sheets[index - 1] : undefined;
    if (!sheet) {
      await this.deps.messaging.sendMessage(externalId, this.sheetPrompt(sheets));
      return;
    }
    const token = await this.token(state.userId);
    const result = await this.deps.accessPortFactory
      .create('google', token)
      .validateSpreadsheetAccess(payload.fileId, sheet.name);
    if (result.kind !== 'success' || !result.preview.rows.length) {
      await this.deps.messaging.sendMessage(
        externalId,
        'No pudimos confirmar lectura y escritura de esa hoja. Elegí otra hoja o escribí cancelar.',
      );
      return;
    }
    const next: Payload = {
      ...payload,
      sheetName: sheet.name,
      proposalId: randomUUID(),
      step: 'same-columns',
      accessVerifiedAt: new Date().toISOString(),
      preview: result.preview.rows.map((row) => ({ index: row.index, values: [...row.values] })),
    };
    await this.move(state, 'SETTINGS_MAPPING', next);
    await this.deps.messaging.sendMessage(
      externalId,
      '¿Las columnas están en las mismas posiciones que en tu hoja actual? Respondé sí o no.',
    );
  }

  private async reviewMapping(
    state: ConversationState,
    payload: Payload,
    reply: string,
    externalId: string,
  ): Promise<void> {
    if (payload.step === 'same-columns') {
      const answer = normalize(reply);
      if (!['si', 'no'].includes(answer)) {
        await this.deps.messaging.sendMessage(
          externalId,
          'Respondé sí o no sobre las posiciones de las columnas.',
        );
        return;
      }
      const source = await this.source(state.userId, payload);
      if (!source) return;
      const rows = payload.preview ?? [];
      const headerRowIndex = await this.deps.headerDetector.detectHeaderRow(
        rows.map((row) => ({
          index: row.index,
          values: row.values.map(cellToString),
        })),
      );
      if (!headerRowIndex) {
        await this.deps.messaging.sendMessage(
          externalId,
          'No pudimos encontrar los encabezados de esa hoja. Elegí otra hoja.',
        );
        const { sheetName: _sheetName, preview: _preview, step: _step, ...reset } = payload;
        await this.move(state, 'SETTINGS_SHEET', reset);
        return;
      }
      const headerRow = rows.find((row) => row.index === headerRowIndex);
      const headers = (headerRow?.values ?? []).map(cellToString);
      let mappings: Mapping[] | null = null;
      if (answer === 'si' && source.headerRowIndex === headerRowIndex) {
        const saved = await this.deps.mappingRepository.findBySpreadsheetId(source.id);
        if (
          saved.length &&
          saved.every(
            (mapping) =>
              normalize(headers[mapping.columnIndex] ?? '') === normalize(mapping.columnHeader),
          )
        ) {
          mappings = saved.map((mapping) => ({
            field: mapping.GasttoField,
            columnIndex: mapping.columnIndex,
            columnHeader: headers[mapping.columnIndex]!,
          }));
        }
      }
      if (!mappings) {
        const samples = rows
          .filter((row) => row.index > headerRowIndex)
          .map((row) => row.values.map(cellToString));
        const inferred = await this.deps.columnInference.infer(headers, samples);
        mappings = inferred.mappings.map((mapping) => ({
          field: mapping.gasttoField,
          columnIndex: mapping.columnIndex,
          columnHeader: headers[mapping.columnIndex] ?? mapping.columnHeader,
        }));
      }
      if (!mappings.length) {
        await this.deps.messaging.sendMessage(
          externalId,
          'No pudimos proponer un mapeo. Elegí otra hoja.',
        );
        const { step: _step, ...reset } = payload;
        await this.move(state, 'SETTINGS_SHEET', reset);
        return;
      }
      const next = { ...payload, step: 'review', headerRowIndex, mappings };
      await this.move(state, 'SETTINGS_MAPPING', next);
      await this.deps.messaging.sendMessage(externalId, this.mappingPrompt(mappings));
      return;
    }
    if (payload.step !== 'review' || !payload.mappings || !payload.headerRowIndex) return;
    if (normalize(reply) === 'confirmar') {
      await this.discoverCategories(state, payload, externalId);
      return;
    }
    const correction = reply.trim().match(/^([a-z_]+)\s*=\s*(\d+)$/i);
    const field = correction?.[1] as GasttoField | undefined;
    const oneBased = Number(correction?.[2]);
    const headers =
      payload.preview?.find((row) => row.index === payload.headerRowIndex)?.values ?? [];
    if (
      !field ||
      !SUPPORTED_GASTTO_FIELDS.includes(field) ||
      !Number.isInteger(oneBased) ||
      oneBased < 1 ||
      oneBased > headers.length ||
      !cellToString(headers[oneBased - 1]).trim()
    ) {
      await this.deps.messaging.sendMessage(externalId, this.mappingPrompt(payload.mappings));
      return;
    }
    const mappings = payload.mappings.filter(
      (mapping) => mapping.field !== field && mapping.columnIndex !== oneBased - 1,
    );
    mappings.push({
      field,
      columnIndex: oneBased - 1,
      columnHeader: String(headers[oneBased - 1]),
    });
    await this.move(state, 'SETTINGS_MAPPING', { ...payload, mappings, proposalId: randomUUID() });
    await this.deps.messaging.sendMessage(externalId, this.mappingPrompt(mappings));
  }

  private async discoverCategories(
    state: ConversationState,
    payload: Payload,
    externalId: string,
  ): Promise<void> {
    const mapping = payload.mappings?.find((entry) => entry.field === 'categoria');
    if (!mapping || !payload.sheetName || !payload.headerRowIndex) {
      await this.deps.messaging.sendMessage(
        externalId,
        'El mapeo debe incluir una columna de categoría.',
      );
      return;
    }
    const token = await this.token(state.userId);
    const subcategory = payload.mappings?.find((entry) => entry.field === 'subcategoria');
    let categories: Category[];
    if (subcategory) {
      const hierarchy = await this.deps.categoryHierarchyReaderFactory
        .create(token)
        .readHierarchy(
          payload.fileId,
          mapping.columnIndex,
          subcategory.columnIndex,
          payload.sheetName,
          payload.headerRowIndex + 1,
        );
      categories = hierarchy.categories.map((name) => ({
        name,
        subcategories: hierarchy.pairs
          .filter((pair) => normalize(pair.category) === normalize(name))
          .map((pair) => pair.subcategory),
      }));
    } else {
      const names = await this.deps.categoryReaderFactory
        .create(token)
        .readCategories(
          payload.fileId,
          mapping.columnIndex,
          payload.sheetName,
          payload.headerRowIndex + 1,
        );
      categories = names.map((name) => ({ name, subcategories: [] }));
    }
    if (!categories.length) categories = [{ name: 'Otros', subcategories: [] }];
    await this.move(state, 'SETTINGS_CATEGORIES', { ...payload, categories });
    await this.deps.messaging.sendMessage(externalId, this.categoryPrompt(categories));
  }

  private async reviewCategories(
    state: ConversationState,
    payload: Payload,
    reply: string,
    externalId: string,
  ): Promise<void> {
    if (
      !payload.categories ||
      !payload.sheetName ||
      !payload.proposalId ||
      !payload.mappings ||
      !payload.headerRowIndex ||
      !payload.accessVerifiedAt
    )
      return;
    if (normalize(reply) === 'confirmar') {
      const outcome = await this.deps.activation.execute({
        userId: state.userId,
        expected: this.deps.transitionState.precondition(state, 'unexpired'),
        candidate: {
          flowId: payload.flowId,
          proposalId: payload.proposalId,
          sourceConfigId: payload.sourceConfigId,
          provider: 'google',
          fileId: payload.fileId,
          fileName: payload.fileName,
          sheetName: payload.sheetName,
          headerRowIndex: payload.headerRowIndex,
          accessVerifiedAt: new Date(payload.accessVerifiedAt),
          mappings: payload.mappings,
          categories: payload.categories,
        },
      });
      if (outcome === 'activated')
        await this.deps.messaging.sendMessage(
          externalId,
          'La nueva hoja quedó activa. Tus gastos anteriores conservan su hoja original.',
        );
      return;
    }
    const parsed = this.parseCategories(reply);
    if (!parsed) {
      await this.deps.messaging.sendMessage(externalId, this.categoryPrompt(payload.categories));
      return;
    }
    await this.move(state, 'SETTINGS_CATEGORIES', {
      ...payload,
      categories: parsed,
      proposalId: randomUUID(),
    });
    await this.deps.messaging.sendMessage(externalId, this.categoryPrompt(parsed));
  }

  private parseCategories(reply: string): Category[] | null {
    if (!reply.trim().toLowerCase().startsWith('categorías:')) return null;
    const names = reply
      .slice(reply.indexOf(':') + 1)
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!names.length) return null;
    const categories = new Map<string, Category>();
    for (const item of names) {
      const [name, child, extra] = item.split('>').map((part) => part.trim());
      if (!name || extra || (child !== undefined && !child)) return null;
      const key = normalize(name);
      const category = categories.get(key) ?? { name, subcategories: [] };
      if (child && !category.subcategories.some((value) => normalize(value) === normalize(child)))
        category.subcategories.push(child);
      categories.set(key, category);
    }
    return [...categories.values()];
  }

  private payload(state: ConversationState): Payload | null {
    const value = state.statePayload;
    return value &&
      typeof value.flowId === 'string' &&
      typeof value.sourceConfigId === 'string' &&
      typeof value.fileId === 'string' &&
      typeof value.fileName === 'string'
      ? (value as Payload)
      : null;
  }

  private async source(userId: string, payload: Payload): Promise<SpreadsheetConfig | null> {
    const config = await this.deps.configRepository.findByUserId(userId);
    return config?.id === payload.sourceConfigId ? config : null;
  }

  private async token(userId: string): Promise<string> {
    return (
      await this.deps.tokenService.getValidAccessToken({
        userId,
        provider: 'google',
        requiredScopes: ['https://www.googleapis.com/auth/spreadsheets'],
      })
    ).accessToken;
  }

  private async move(
    state: ConversationState,
    targetState: FsmState,
    payload: Payload | null,
  ): Promise<void> {
    await this.deps.transitionState.execute({
      userId: state.userId,
      targetState,
      payload,
      expiresAt: targetState === 'IDLE' ? null : new Date(Date.now() + timeoutMs),
      expected: this.deps.transitionState.precondition(state, 'unexpired'),
    });
  }

  private sheetPrompt(sheets: ReadonlyArray<{ name: string }>): string {
    return `Elegí una hoja:\n${sheets.map((sheet, index) => `${index + 1}. ${sheet.name}`).join('\n')}\nEscribí el número o cancelar.`;
  }

  private mappingPrompt(mappings: Mapping[]): string {
    return `Revisá las columnas:\n${mappings
      .map((mapping) => `${mapping.field}: ${mapping.columnIndex + 1} (${mapping.columnHeader})`)
      .join('\n')}\nEscribí confirmar o corregí con campo=número (por ejemplo, monto=2).`;
  }

  private categoryPrompt(categories: Category[]): string {
    return `Revisá las categorías:\n${categories
      .map(
        (category) =>
          `${category.name}${category.subcategories.length ? ` > ${category.subcategories.join(', ')}` : ''}`,
      )
      .join('\n')}\nEscribí confirmar o categorías: Nombre; Otra > Subcategoría.`;
  }
}
