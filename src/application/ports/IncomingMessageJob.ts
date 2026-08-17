// LAYER: Application
// Shared type for BullMQ job data enqueued by the webhook route.
// Lives in the Application layer because both the route (Interfaces)
// and the thin worker (Interfaces) depend on its shape.
// Timestamp is serialized as ISO string because BullMQ job data
// must be JSON-serializable.

import { z } from 'zod';

export const CallbackDataSchema = z
  .object({ action: z.enum(['confirm', 'correct', 'cancel']), field: z.string().min(1).optional() })
  .strict();

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
