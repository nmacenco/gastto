// Configuración de Drizzle Kit para generación y ejecución de migraciones.
// `drizzle-kit generate` lee este archivo para producir los SQL de migración.

import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema:    './src/infrastructure/db/schema/index.ts',
  out:       './src/infrastructure/db/migrations',
  dialect:   'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  verbose:  true,
  strict:   true,
});
