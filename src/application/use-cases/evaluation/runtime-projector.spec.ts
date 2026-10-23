import { describe, expect, it } from 'vitest';
import corpusJson from '../../../../evals/semantic-router/corpus.json';
import responsesJson from '../../../../evals/semantic-router/corpus-responses.json';
import { ProjectSemanticRouterInput } from '../../services/semantic-router/ProjectSemanticRouterInput';
import { assessSemanticProposal } from '../../services/semantic-router/contracts';
import type { ConversationState, FsmState } from '../../../domain/entities/ConversationState';
import {
  OfflineResponsesSchema,
  OfflineSemanticRouterAdapter,
} from '../../../infrastructure/adapters/llm/OfflineSemanticRouterAdapter';
import { EvaluationDatasetSchema } from './contracts';

const dataset = EvaluationDatasetSchema.parse(corpusJson);
const router = new OfflineSemanticRouterAdapter(OfflineResponsesSchema.parse(responsesJson));
const projector = new ProjectSemanticRouterInput();
const binding = {
  operationId: 'abcdefghijklmnopqrstuv',
  revision: 1,
  presentedAt: '2026-09-14T10:00:00.000Z',
};
const extracted = {
  monto: 20,
  moneda: 'EUR' as const,
  categoriaRaw: 'Comida',
  subcategoriaRaw: null,
  fechaRaw: '2026-09-14',
  medioPago: null,
  confianzaCategoria: 'alta' as const,
  confianzaSubcategoria: 'nula' as const,
};

function state(currentState: FsmState, statePayload: Record<string, unknown> | null) {
  return {
    userId: 'fixture-user',
    revision: '1',
    currentState,
    statePayload,
    enteredAt: new Date('2026-09-14T10:00:00.000Z'),
    expiresAt: new Date('2099-09-14T10:10:00.000Z'),
    updatedAt: new Date('2026-09-14T10:00:00.000Z'),
  } satisfies ConversationState;
}

function reviewPayload(): Record<string, unknown> {
  return {
    extracted,
    rawMessage: 'Cena 20 EUR',
    resolvedDate: '2026-09-14',
    resolvedCategory: 'Comida',
    resolvedCategoryId: null,
    categoryStatus: 'confirmed',
    resolvedSubcategory: null,
    resolvedSubcategoryId: null,
    subcategoryStatus: 'none',
    subcategoryEnabled: false,
    reviewBinding: binding,
  };
}

const runtimeStates: Record<string, ConversationState> = {
  'regional-ar': state('IDLE', null),
  'cancel-receiving': state('EXPENSE_RECEIVING', { raw_message: 'Taxi 12 EUR' }),
  'currency-answer': state('EXPENSE_CLARIFYING', {
    missingField: 'moneda',
    rawMessage: 'Cena 20',
    partialExtracted: { ...extracted, moneda: null },
  }),
  condition: state('EXPENSE_REVIEW', reviewPayload()),
  'retry-request': state('EXPENSE_SAVING_RETRY', {
    expense: { ...reviewPayload(), reviewBinding: undefined },
    failureCode: 'NETWORK_ERROR',
    firstAttemptAt: '2026-09-14T10:00:00.000Z',
    attemptCount: 1,
    actionBinding: binding,
  }),
  'undo-condition': state('EXPENSE_UNDO_CONFIRMING', {
    pendingExpenseId: 'expense-1',
    actionBinding: binding,
  }),
  'selector-missing': state('ONBOARDING_FILE', {
    fileList: [
      {
        id: 'file-1',
        name: 'Casa',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        modifiedAt: '2026-09-14T10:00:00.000Z',
      },
      {
        id: 'file-2',
        name: 'Viajes',
        mimeType: 'application/vnd.google-apps.spreadsheet',
        modifiedAt: '2026-09-14T10:00:00.000Z',
      },
    ],
  }),
  'h-ambiguous-option': state('ONBOARDING_SHEET', {
    selectedFileId: 'file-1',
    selectedFileName: 'Presupuesto',
    provider: 'google',
    sheetList: [
      { name: 'Casa', index: 0 },
      { name: 'Viajes', index: 1 },
    ],
  }),
  'sheet-idk': state('ONBOARDING_SHEET', {
    selectedFileId: 'file-1',
    sheetList: [
      { name: 'Casa', index: 0 },
      { name: 'Viajes', index: 1 },
    ],
    step: 'idk',
  }),
  'sheet-empty': state('ONBOARDING_SHEET', {
    selectedFileId: 'file-1',
    selectedFileName: 'Presupuesto',
    selectedSheetName: 'Casa',
    provider: 'google',
    sheetList: [
      { name: 'Casa', index: 0 },
      { name: 'Viajes', index: 1 },
    ],
    step: 'empty-sheet-confirm',
  }),
};

describe('offline semantic evaluation with runtime projector fixtures', () => {
  it.each(Object.entries(runtimeStates))(
    'keeps frozen label expectations for %s',
    async (caseId, conversationState) => {
      const evaluationCase = dataset.cases.find((candidate) => candidate.id === caseId);
      expect(evaluationCase).toBeDefined();
      const projection = projector.execute({
        rawMessage: evaluationCase!.input.rawMessage,
        conversationState,
      });
      expect(projection.status).toBe('supported');
      if (projection.status !== 'supported') return;

      const result = await router.decide(projection.input);
      const assessment = assessSemanticProposal(projection.input, result);
      expect(assessment.status).toBe(evaluationCase!.expectedAssessment);
      if (assessment.status !== 'router_failure') {
        expect(evaluationCase!.acceptedDecisions).toContainEqual(assessment.decision);
      }
    },
  );

  it('records intentionally unsupported runtime contexts separately from accuracy', () => {
    const unsupported = [
      projector.execute({
        rawMessage: 'hola',
        conversationState: state('EXPENSE_SAVING', {}),
      }),
      projector.execute({
        rawMessage: 'hola',
        conversationState: state('ONBOARDING_SHEET', { step: 'future-step' }),
      }),
    ];
    expect(unsupported).toEqual([
      { status: 'unsupported', code: 'UNSUPPORTED_STATE' },
      { status: 'unsupported', code: 'UNSUPPORTED_SUBSTEP' },
    ]);
  });
});
