// LAYER: Config
// Centralized environment variable validation via Zod.
// Loaded once at bootstrap; crashes early if required variables are missing or invalid.
//
// Rules:
// - Every process.env access must go through this file. No inline `process.env.FOO!` elsewhere.
// - Optional vars are typed with `undefined` (exactOptionalPropertyTypes: true).

import { envSchema } from './env.schema';

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  throw new Error('Invalid environment variables — see errors above');
}

export const env = parsed.data;
export type Env = typeof env;
