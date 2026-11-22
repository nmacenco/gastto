// LAYER: Infrastructure
// Durable, bounded receipts for Telegram /start deliveries.
import { createHmac } from 'node:crypto';
import { lte, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../schema';

export class DrizzleStartReplayGuard {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly keyMaterial: string,
  ) {}

  async claim(chatId: string, messageId: string): Promise<boolean> {
    const digest = createHmac('sha256', this.keyMaterial)
      .update(`telegram:${chatId}:${messageId}`)
      .digest('hex');
    const [created] = await this.db
      .insert(schema.accountStartReplays)
      .values({ digest, expiresAt: sql`now() + interval '48 hours'` })
      .onConflictDoNothing()
      .returning({ digest: schema.accountStartReplays.digest });
    return Boolean(created);
  }

  async pruneExpired(): Promise<void> {
    await this.db
      .delete(schema.accountStartReplays)
      .where(lte(schema.accountStartReplays.expiresAt, sql`now()`));
  }
}
