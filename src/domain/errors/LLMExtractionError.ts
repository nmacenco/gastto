// LAYER: Domain
export type LLMExtractionErrorCode =
  | 'LLM_TIMEOUT'
  | 'LLM_CANCELLED'
  | 'LLM_EMPTY_RESPONSE'
  | 'LLM_OUTPUT_TRUNCATED'
  | 'LLM_INVALID_JSON'
  | 'LLM_INVALID_SCHEMA'
  | 'LLM_PROVIDER_ERROR';

/** Safe boundary failure: never retain provider bodies, prompts, or SDK causes. */
export class LLMExtractionError extends Error {
  constructor(public readonly code: LLMExtractionErrorCode) {
    super(code);
    this.name = 'LLMExtractionError';
  }
}
