// LAYER: Infrastructure
// A PostgreSQL row lock coordinates external account work with the deletion barrier.
import { eq } from 'drizzle-orm';
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
    return this.db.transaction(async (tx) => {
      // Confirmation takes FOR UPDATE on the same row. If work started first,
      // confirmation waits until the external effect and local result settle.
      const [owner] = await tx
        .select({ userId: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, userId))
        .for('key share')
        .limit(1);
      if (!owner) throw new AccountDeletionInProgressError();

      const [deleting] = await tx
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations)
        .where(eq(schema.accountDeletionOperations.userId, userId))
        .limit(1);
      if (deleting) throw new AccountDeletionInProgressError();

      const scope = { userId, active: true };
      try {
        return await this.activeWork.run(scope, work);
      } finally {
        // Detached tasks must acquire a new fence after the outer work settles.
        scope.active = false;
      }
    });
  }
}
