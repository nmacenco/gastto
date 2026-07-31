// LAYER: Application
// Shared type for BullMQ job data enqueued by the webhook route.
// Lives in the Application layer because both the route (Interfaces)
// and the thin worker (Interfaces) depend on its shape.
// Timestamp is serialized as ISO string because BullMQ job data
// must be JSON-serializable.

export type IncomingMessageJobData = {
  messageType: 'TEXT' | 'UNSUPPORTED' | 'MALFORMED' | 'CALLBACK';
  chatId: string;
  userId?: string | undefined;
  text?: string | undefined;
  callbackData?: { action: 'confirm' | 'correct' | 'cancel'; field?: string } | undefined;
  timestamp: string;
  channel: 'telegram' | 'whatsapp';
  externalMessageId: string;
  rawPayload?: unknown;
};
