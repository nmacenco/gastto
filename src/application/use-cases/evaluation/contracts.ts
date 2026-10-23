import { z } from 'zod';
import {
  ConversationDecisionSchema,
  SemanticRouterInputSchema,
  errorCodeSchema,
} from '../../services/semantic-router/contracts';

const displayedOptionSchema = z
  .object({ position: z.number().int().positive().max(20), label: z.string().min(1).max(200) })
  .strict();
const optionSnapshotSchema = z
  .object({
    revision: z.string().regex(/^(0|[1-9]\d*)$/),
    state: z.enum(['ONBOARDING_FILE', 'ONBOARDING_SHEET']),
    substep: z.enum(['idk']).nullable(),
    options: z.array(displayedOptionSchema).min(1).max(20),
  })
  .strict()
  .superRefine((snapshot, ctx) => {
    if (
      snapshot.options.some((option, index) => option.position !== index + 1) ||
      (snapshot.state === 'ONBOARDING_FILE' && snapshot.substep !== null)
    )
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid ordered option snapshot' });
  });
const resolutionResultSchema = z.discriminatedUnion('status', [
  z
    .object({ status: z.literal('resolved'), position: z.number().int().positive().max(20) })
    .strict(),
  z
    .object({
      status: z.literal('ambiguous'),
      candidatePositions: z.array(z.number().int().positive().max(20)).min(2).max(20),
    })
    .strict(),
  z.object({ status: z.literal('not_found') }).strict(),
  z.object({ status: z.literal('stale') }).strict(),
]);
const optionResolutionSchema = z
  .object({
    expected: optionSnapshotSchema,
    current: optionSnapshotSchema,
    expectedResult: resolutionResultSchema,
  })
  .strict();

export const identifierSchema = z.string().regex(/^[a-zA-Z0-9._-]{1,80}$/);
export const EvaluationCaseSchema = z
  .object({
    id: identifierSchema,
    family: identifierSchema.optional(),
    datasetVersion: identifierSchema,
    split: z.enum(['development', 'held_out']),
    tags: z.array(identifierSchema).min(1).max(20),
    input: SemanticRouterInputSchema,
    acceptedDecisions: z.array(ConversationDecisionSchema).max(10),
    expectedHandling: z.enum(['semantic_proposal', 'deterministic_only', 'clarify']),
    expectedFailure: errorCodeSchema.nullable(),
    expectedAssessment: z.enum(['allowed', 'forbidden_action', 'router_failure']),
    mustNotAuthorize: z
      .array(
        z.enum([
          'save',
          'delete',
          'retry',
          'undo_confirmation',
          'arbitrary_reconfiguration',
          'fsm_transition',
        ]),
      )
      .max(6),
    optionResolution: optionResolutionSchema.optional(),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      (c.expectedFailure !== null) !== (c.expectedAssessment === 'router_failure') ||
      (c.expectedFailure === null && c.acceptedDecisions.length === 0) ||
      (c.expectedFailure !== null && c.acceptedDecisions.length > 0)
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent failure expectation' });
    }
    if (
      (c.expectedAssessment === 'forbidden_action' &&
        c.acceptedDecisions.some((d) => c.input.allowedActions.includes(d.action))) ||
      (c.expectedAssessment === 'allowed' &&
        c.acceptedDecisions.some((d) => !c.input.allowedActions.includes(d.action)))
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Expected decision forbidden by input',
      });
    }
    if (
      c.expectedHandling === 'clarify' &&
      c.acceptedDecisions.some((d) => d.action !== 'request_clarification')
    ) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Expected clarification required' });
    }
    if (c.optionResolution) {
      const expectedOptions = c.optionResolution.expected.options;
      if (
        c.input.state !== c.optionResolution.expected.state ||
        c.input.substep !== c.optionResolution.expected.substep ||
        JSON.stringify(c.input.context.options) !== JSON.stringify(expectedOptions) ||
        c.acceptedDecisions.length === 0 ||
        c.acceptedDecisions.some((decision) => decision.action !== 'select_option') ||
        c.expectedAssessment !== 'allowed'
      )
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid option resolution case' });
    }
  });
export const DatasetProvenanceSchema = z
  .object({
    labelVersion: identifierSchema,
    splitVersion: identifierSchema,
    normalizationVersion: z.literal('nfkc-case-whitespace-v1'),
    source: z.literal('synthetic-and-user-supplied-regression'),
    labelMethod: z.literal('author-reviewed-without-candidate-predictions'),
    independentHumanReview: z.literal('pending'),
    heldOutStatus: z.literal('frozen-before-candidate-evaluation'),
    frozenOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })
  .strict();
// Leakage detection only. Router inputs and selector equality are never normalized here.
export function normalizeForSplitCheck(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}
export const EvaluationDatasetSchema = z
  .object({
    version: identifierSchema,
    provenance: DatasetProvenanceSchema.optional(),
    cases: z.array(EvaluationCaseSchema).min(1).max(1000),
  })
  .strict()
  .superRefine((d, ctx) => {
    const families = new Map<string, string>();
    const messages = new Map<string, string>();
    for (const c of d.cases) {
      if (d.provenance && !c.family)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Family required for versioned corpus',
        });
      for (const [map, key] of [
        [families, c.family],
        [messages, normalizeForSplitCheck(c.input.rawMessage)],
      ] as const) {
        if (!key) continue;
        if (map.has(key) && map.get(key) !== c.split)
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'Cross-split family or message leakage',
          });
        map.set(key, c.split);
      }
    }

    if (
      new Set(d.cases.map((c) => c.id)).size !== d.cases.length ||
      d.cases.some((c) => c.datasetVersion !== d.version)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Duplicate ID or inconsistent version',
      });
    }
  });
export type EvaluationCase = z.infer<typeof EvaluationCaseSchema>;
export type EvaluationDataset = z.infer<typeof EvaluationDatasetSchema>;
