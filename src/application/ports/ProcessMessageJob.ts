// LAYER: Application
// Shared type for BullMQ job data enqueued by the webhook route.
// Lives in the Application layer because both the route (Interfaces)
// and the router use case (Application) depend on its shape.

export type ProcessMessageJobData = {
  userId: string;
  rawMessage: string;
  channel: 'telegram' | 'whatsapp';
  externalId: string;
  receivedAt: string;
};
