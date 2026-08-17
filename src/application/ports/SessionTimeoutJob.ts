// LAYER: Application
// Repeatable session timeout jobs intentionally carry no caller-controlled data.

import { z } from 'zod';

export const SessionTimeoutJobDataSchema = z.object({}).strict();
export type SessionTimeoutJobData = z.infer<typeof SessionTimeoutJobDataSchema>;
