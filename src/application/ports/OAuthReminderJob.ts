// LAYER: Application
// Serializable OAuth reminder job contract shared by producers and worker.

import { z } from 'zod';

export const OAuthReminderJobDataSchema = z
  .object({
    userId: z.string().min(1),
    externalId: z.string().min(1),
    channel: z.enum(['telegram', 'whatsapp']),
  })
  .strict();

export type OAuthReminderJobData = z.infer<typeof OAuthReminderJobDataSchema>;
