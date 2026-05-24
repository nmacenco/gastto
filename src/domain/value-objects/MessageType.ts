// LAYER: Domain
// Message type discriminated union. Used by NormalizedPayload and routing logic.

export type MessageType = 'TEXT' | 'UNSUPPORTED' | 'MALFORMED';
