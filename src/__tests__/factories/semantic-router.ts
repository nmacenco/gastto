import type { ConversationDecision } from '../../domain/value-objects/conversation-decision';
import type { SemanticRouterResult } from '../../domain/ports/SemanticRouterPort';
import dataset from '../../../evals/semantic-router/development.json';
import responses from '../../../evals/semantic-router/offline-responses.json';
import { EvaluationDatasetSchema } from '../../application/use-cases/evaluation/contracts';
import {
  OfflineResponsesSchema,
  OfflineSemanticRouterAdapter,
} from '../../infrastructure/adapters/llm/OfflineSemanticRouterAdapter';

export function buildSemanticDataset() {
  return EvaluationDatasetSchema.parse(structuredClone(dataset));
}
export function buildOfflineResponses() {
  return OfflineResponsesSchema.parse(structuredClone(responses));
}
export function buildOfflineRouter() {
  return new OfflineSemanticRouterAdapter(buildOfflineResponses());
}
export function buildSemanticInput() {
  return buildSemanticDataset().cases[0]!.input;
}

export function buildRouterCompletion() {
  return {
    id: 'test-completion',
    object: 'chat.completion' as const,
    created: 0,
    model: 'gpt-4o-mini-2024-07-18',
    choices: [
      {
        index: 0,
        finish_reason: 'stop' as const,
        logprobs: null,
        message: {
          role: 'assistant' as const,
          content: '{"decision":{"action":"register_expense"}}',
          refusal: null,
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110 },
  };
}

export function buildProposedRouterResult(
  action: ConversationDecision,
): Extract<SemanticRouterResult, { status: 'proposed' }> {
  return {
    status: 'proposed' as const,
    decision: action,
    metadata: {
      provider: 'openai',
      model: 'gpt-4o-mini-2024-07-18',
      promptVersion: 'semantic-openai-v2',
      contractVersion: 'semantic-contract-v2',
      latencyMs: 10,
      inputTokens: 100,
      outputTokens: 10,
    },
  };
}
