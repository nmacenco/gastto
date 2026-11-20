// LAYER: Infrastructure
// A durable per-account counter coordinates external work with deletion.
import { and, eq, gt, sql } from 'drizzle-orm';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { AccountExternalWorkFence } from '../../../application/ports/AccountExternalWorkFence';
import { AccountDeletionInProgressError } from '../../../application/ports/AccountExternalWorkFence';
import * as schema from '../schema';

export class DrizzleAccountExternalWorkFence implements AccountExternalWorkFence {
  private readonly activeWork = new AsyncLocalStorage<{ userId: string; active: boolean }>();

  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async run<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const current = this.activeWork.getStore();
    if (current?.active && current.userId === userId) return work();
    // Registration and barrier creation lock the same user row. Once this
    // transaction commits, connection loss cannot erase the active-work marker.
    await this.db.transaction(async (tx) => {
      const [owner] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, userId))
        .for('update')
        .limit(1);
      if (!owner) throw new AccountDeletionInProgressError();

      const [deleting] = await tx
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations)
        .where(eq(schema.accountDeletionOperations.userId, userId))
        .limit(1);
      if (deleting) throw new AccountDeletionInProgressError();
      await tx
        .update(schema.users)
        .set({
          activeExternalWorkCount: sql`${schema.users.activeExternalWorkCount} + 1`,
        })
        .where(eq(schema.users.userId, userId));
    });
    const scope = { userId, active: true };
    try {
      return await this.activeWork.run(scope, work);
    } finally {
      // Detached tasks must acquire a new fence after the outer work settles.
      scope.active = false;
      const [released] = await this.db
        .update(schema.users)
        .set({ activeExternalWorkCount: sql`${schema.users.activeExternalWorkCount} - 1` })
        .where(and(eq(schema.users.userId, userId), gt(schema.users.activeExternalWorkCount, 0)))
        .returning({ userId: schema.users.userId });
      if (!released) throw new Error('ACCOUNT_EXTERNAL_WORK_RELEASE_MISSING');
    }
  }
}
