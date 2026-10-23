// LAYER: Application
// Shared type for BullMQ job data enqueued by the webhook route.
// Lives in the Application layer because both the route (Interfaces)
// and the thin worker (Interfaces) depend on its shape.
// Timestamp is serialized as ISO string because BullMQ job data
// must be JSON-serializable.

import { z } from 'zod';

const BoundCallbackDataSchema = z
  .object({
    version: z.literal(1),
    action: z.enum(['confirm', 'correct', 'cancel']),
    operationId: z.string().regex(/^[A-Za-z0-9_-]{22}$/),
    reviewRevision: z.number().int().positive().safe(),
  })
  .strict();

const LegacyCallbackDataSchema = z
  .object({
    action: z.enum(['confirm', 'correct', 'cancel']),
    field: z.string().min(1).optional(),
  })
  .strict();

const InvalidCallbackDataSchema = z.object({ invalid: z.literal(true) }).strict();

export const CallbackDataSchema = z.union([
  BoundCallbackDataSchema,
  LegacyCallbackDataSchema,
  InvalidCallbackDataSchema,
]);

export const IncomingMessageJobDataSchema = z
  .object({
    messageType: z.enum(['TEXT', 'UNSUPPORTED', 'MALFORMED', 'CALLBACK']),
    chatId: z.string().min(1),
    userId: z.string().min(1).optional(),
    text: z.string().optional(),
    callbackData: CallbackDataSchema.optional(),
    timestamp: z.string().datetime({ offset: true }),
    channel: z.enum(['telegram', 'whatsapp']),
    externalMessageId: z.string().min(1),
    rawPayload: z.unknown().optional(),
  })
  .strict();

export type IncomingMessageJobData = z.infer<typeof IncomingMessageJobDataSchema>;
