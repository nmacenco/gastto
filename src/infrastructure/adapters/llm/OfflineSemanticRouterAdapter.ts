import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  SemanticRouterInput,
  SemanticRouterPort,
  SemanticRouterResult,
} from '../../../domain/ports/SemanticRouterPort';
import {
  CONTRACT_VERSION,
  ConversationDecisionSchema,
  SemanticRouterInputSchema,
  errorCodeSchema,
} from '../../../application/services/semantic-router/contracts';

export const OfflineResponsesSchema = z.record(
  z.string().regex(/^[a-f0-9]{64}$/),
  z.discriminatedUnion('status', [
    z.object({ status: z.literal('response'), content: z.unknown() }).strict(),
    z.object({ status: z.literal('failed'), code: errorCodeSchema }).strict(),
  ]),
);
export function fixtureKey(input: SemanticRouterInput): string {
  return createHash('sha256')
    .update(JSON.stringify([input.state, input.substep, input.rawMessage]))
    .digest('hex');
}

// No labels, evaluation cases or expected decisions are accepted by this adapter.
export class OfflineSemanticRouterAdapter implements SemanticRouterPort {
  constructor(private readonly responses: z.infer<typeof OfflineResponsesSchema>) {}

  decide(input: SemanticRouterInput): Promise<SemanticRouterResult> {
    const metadata = {
      provider: 'offline',
      model: 'protocol-fixture',
      promptVersion: 'none',
      contractVersion: CONTRACT_VERSION,
      latencyMs: 0,
      inputTokens: null,
      outputTokens: null,
    };
    if (!SemanticRouterInputSchema.safeParse(input).success) {
      return Promise.resolve({ status: 'failed', code: 'INVALID_INPUT', metadata });
    }
    const response = this.responses[fixtureKey(input)];
    if (!response) throw new Error('MISSING_PROTOCOL_FIXTURE');
    if (response.status === 'failed') return Promise.resolve({ ...response, metadata });
    const decision = ConversationDecisionSchema.safeParse(response.content);
    return Promise.resolve(
      decision.success
        ? { status: 'proposed', decision: decision.data, metadata }
        : { status: 'failed', code: 'INVALID_OUTPUT', metadata },
    );
  }
}
