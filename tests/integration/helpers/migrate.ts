// LAYER: Tests / Integration Helpers
// Runs Drizzle SQL migration files against the test database using the postgres driver.

import postgres from 'postgres';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const MIGRATIONS_DIR = join(__dirname, '../../../src/infrastructure/db/migrations');

/**
 * Reads all `.sql` migration files in order and executes them against the
 * provided postgres client. Skips the meta/ directory created by drizzle-kit.
 */
export async function runMigrations(client: postgres.Sql): Promise<void> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  const sqlFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith('.sql'))
    .map((e) => e.name)
    .sort();

  for (const file of sqlFiles) {
    const sql = await readFile(join(MIGRATIONS_DIR, file), 'utf-8');
    // drizzle-kit generates statement-breakpoint comments; split and execute each statement
    const statements = sql
      .split('--> statement-breakpoint')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const stmt of statements) {
      await client.unsafe(stmt);
    }
  }
}
