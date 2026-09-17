import { z } from 'zod';
import {
  getFinancialExecutionClaim,
  type ConversationState,
} from '../../../domain/entities/ConversationState';

export const OPTION_REFERENCE_VERSION = 'option-reference-v1';

export type OptionSelectionState = 'ONBOARDING_FILE' | 'ONBOARDING_SHEET';
export type OptionSelectionSubstep = null | 'idk';

export interface DisplayedOptionReference {
  readonly position: number;
  readonly label: string;
}

export interface OptionSelectionSnapshot {
  readonly revision: string;
  readonly state: OptionSelectionState;
  readonly substep: OptionSelectionSubstep;
  readonly options: readonly DisplayedOptionReference[];
}

export interface ResolveOptionReferenceInput {
  readonly userReference: string;
  readonly expected: OptionSelectionSnapshot;
  readonly current: OptionSelectionSnapshot;
}

export type ResolveOptionReferenceResult =
  | { readonly status: 'resolved'; readonly position: number }
  | { readonly status: 'ambiguous'; readonly candidatePositions: readonly number[] }
  | { readonly status: 'not_found' }
  | { readonly status: 'stale' };

const boundedIdentifier = z.string().trim().min(1).max(500);
const boundedLabel = z.string().trim().min(1).max(200);
const cloudFileSchema = z
  .object({
    id: boundedIdentifier,
    name: boundedLabel,
    mimeType: z.string().trim().min(1).max(200),
    modifiedAt: z.string().datetime({ offset: true }),
  })
  .strict();
const sheetInfoSchema = z
  .object({ name: boundedLabel, index: z.number().int().nonnegative() })
  .strict();
const providerSchema = z.enum(['google', 'microsoft']);

export const onboardingFilePayloadSchema = z
  .object({ fileList: z.array(cloudFileSchema).min(1).max(20) })
  .strict();
export const onboardingSheetDefaultPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    selectedFileName: boundedLabel,
    provider: providerSchema,
    sheetList: z.array(sheetInfoSchema).min(1).max(20),
  })
  .strict();
export const onboardingSheetIdkPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    sheetList: z.array(sheetInfoSchema).min(1).max(20),
    step: z.literal('idk'),
  })
  .strict();
export const onboardingSheetEmptyPayloadSchema = z
  .object({
    selectedFileId: boundedIdentifier,
    selectedFileName: boundedLabel,
    selectedSheetName: boundedLabel,
    provider: providerSchema,
    step: z.literal('empty-sheet-confirm'),
    sheetList: z.array(sheetInfoSchema).min(1).max(20).optional(),
  })
  .strict();

export function normalizeOptionReference(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

export function projectOptionSelectionSnapshot(
  conversationState: ConversationState,
  now = Date.now(),
): OptionSelectionSnapshot | null {
  if (
    (conversationState.expiresAt !== null && conversationState.expiresAt.getTime() <= now) ||
    getFinancialExecutionClaim(conversationState.statePayload) !== null
  )
    return null;

  if (conversationState.currentState === 'ONBOARDING_FILE') {
    const parsed = onboardingFilePayloadSchema.safeParse(conversationState.statePayload);
    if (!parsed.success) return null;
    return {
      revision: conversationState.revision,
      state: 'ONBOARDING_FILE',
      substep: null,
      options: parsed.data.fileList.map((file, index) => ({
        position: index + 1,
        label: file.name,
      })),
    };
  }

  if (conversationState.currentState !== 'ONBOARDING_SHEET') return null;
  const step = conversationState.statePayload?.step;
  if (step !== undefined && step !== 'idk') return null;
  const parsed =
    step === 'idk'
      ? onboardingSheetIdkPayloadSchema.safeParse(conversationState.statePayload)
      : onboardingSheetDefaultPayloadSchema.safeParse(conversationState.statePayload);
  if (!parsed.success) return null;
  return {
    revision: conversationState.revision,
    state: 'ONBOARDING_SHEET',
    substep: step === 'idk' ? 'idk' : null,
    options: parsed.data.sheetList.map((sheet, index) => ({
      position: index + 1,
      label: sheet.name,
    })),
  };
}

const positionWords: ReadonlyArray<readonly string[]> = [
  ['uno', 'un', 'una', 'primero', 'primer', 'primera'],
  ['dos', 'segundo', 'segunda'],
  ['tres', 'tercero', 'tercer', 'tercera'],
  ['cuatro', 'cuarto', 'cuarta'],
  ['cinco', 'quinto', 'quinta'],
  ['seis', 'sexto', 'sexta'],
  ['siete', 'septimo', 'septima'],
  ['ocho', 'octavo', 'octava'],
  ['nueve', 'noveno', 'novena'],
  ['diez', 'decimo', 'decima'],
  ['once', 'undecimo', 'undecima'],
  ['doce', 'duodecimo', 'duodecima'],
  ['trece', 'decimotercero', 'decimotercera'],
  ['catorce', 'decimocuarto', 'decimocuarta'],
  ['quince', 'decimoquinto', 'decimoquinta'],
  ['dieciseis', 'decimosexto', 'decimosexta'],
  ['diecisiete', 'decimoseptimo', 'decimoseptima'],
  ['dieciocho', 'decimoctavo', 'decimoctava'],
  ['diecinueve', 'decimonoveno', 'decimonovena'],
  ['veinte', 'vigesimo', 'vigesima'],
];

function positionPhrases(position: number): readonly string[] {
  const digit = String(position);
  const words = positionWords[position - 1] ?? [];
  const values = [digit, `${digit}º`, `${digit}ª`, ...words];
  return values.flatMap((value) => [
    value,
    `numero ${value}`,
    `posicion ${value}`,
    `opcion ${value}`,
    `archivo ${value}`,
    `hoja ${value}`,
    `opcion numero ${value}`,
    `archivo numero ${value}`,
    `hoja numero ${value}`,
    `el ${value}`,
    `la ${value}`,
    `el archivo ${value}`,
    `la hoja ${value}`,
    `la opcion ${value}`,
    `el ${value} archivo`,
    `la ${value} hoja`,
    `la ${value} opcion`,
    `${value} archivo`,
    `${value} hoja`,
    `${value} opcion`,
  ]);
}

function snapshotsEqual(
  expected: OptionSelectionSnapshot,
  current: OptionSelectionSnapshot,
): boolean {
  return (
    expected.revision === current.revision &&
    expected.state === current.state &&
    expected.substep === current.substep &&
    expected.options.length === current.options.length &&
    expected.options.every(
      (option, index) =>
        option.position === current.options[index]?.position &&
        option.label === current.options[index]?.label,
    )
  );
}

export class ResolveOptionReference {
  execute(input: ResolveOptionReferenceInput): ResolveOptionReferenceResult {
    if (!snapshotsEqual(input.expected, input.current)) return { status: 'stale' };
    if (input.userReference.length > 200) return { status: 'not_found' };

    const reference = normalizeOptionReference(input.userReference);
    if (!reference) return { status: 'not_found' };

    const candidates = new Set<number>();
    if (/^\d+$/.test(reference)) {
      const numericPosition = Number(reference);
      if (input.current.options.some((option) => option.position === numericPosition))
        candidates.add(numericPosition);
    }
    for (const option of input.current.options) {
      if (normalizeOptionReference(option.label) === reference) candidates.add(option.position);
      if (positionPhrases(option.position).includes(reference)) candidates.add(option.position);
    }
    const candidatePositions = [...candidates].sort((a, b) => a - b);
    if (candidatePositions.length === 1)
      return { status: 'resolved', position: candidatePositions[0]! };
    if (candidatePositions.length > 1) return { status: 'ambiguous', candidatePositions };
    return { status: 'not_found' };
  }
}
