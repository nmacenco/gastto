// LAYER: Application
// Shared type for BullMQ job data enqueued by the webhook route.
// Lives in the Application layer because both the route (Interfaces)
// and the router use case (Application) depend on its shape.

import { z } from 'zod';
import { CallbackDataSchema } from './IncomingMessageJob';

export const ProcessMessageJobDataSchema = z
  .object({
    userId: z.string().min(1),
    rawMessage: z.string(),
    channel: z.enum(['telegram', 'whatsapp']),
    externalId: z.string().min(1),
    externalMessageId: z.string().min(1),
    receivedAt: z.string().datetime({ offset: true }),
    callbackData: CallbackDataSchema.optional(),
  })
  .strict();

export type ProcessMessageJobData = z.infer<typeof ProcessMessageJobDataSchema>;
