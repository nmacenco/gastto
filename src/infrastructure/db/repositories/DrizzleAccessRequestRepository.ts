import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type {
  AccessApprovalOutcome,
  AccessRequest,
  AccessRequestKind,
  AccessRequestRepository,
  AccessRequestSubmission,
} from '../../../domain/ports/AccessRequestRepository';
import * as schema from '../schema';

type AccessRow = typeof schema.accessRequests.$inferSelect;

function toRequest(row: AccessRow): AccessRequest {
  return {
    ...row,
    kind: row.kind as AccessRequestKind,
    status: row.status as AccessRequest['status'],
  };
}

export class DrizzleAccessRequestRepository implements AccessRequestRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async findApproved(userId: string): Promise<AccessRequest | null> {
    const [row] = await this.db
      .select()
      .from(schema.accessRequests)
      .where(
        and(
          eq(schema.accessRequests.userId, userId),
          eq(schema.accessRequests.status, 'approved'),
          isNotNull(schema.accessRequests.activatedAt),
        ),
      )
      .limit(1);
    return row ? toRequest(row) : null;
  }

  async findApprovedReplacement(userId: string): Promise<AccessRequest | null> {
    const [row] = await this.db
      .select()
      .from(schema.accessRequests)
      .where(
        and(
          eq(schema.accessRequests.userId, userId),
          eq(schema.accessRequests.status, 'approved'),
          eq(schema.accessRequests.kind, 'replacement'),
          isNull(schema.accessRequests.activatedAt),
        ),
      )
      .limit(1);
    return row ? toRequest(row) : null;
  }

  async findPending(userId: string): Promise<AccessRequest | null> {
    const [row] = await this.db
      .select()
      .from(schema.accessRequests)
      .where(
        and(eq(schema.accessRequests.userId, userId), eq(schema.accessRequests.status, 'pending')),
      )
      .limit(1);
    return row ? toRequest(row) : null;
  }

  async findById(id: string): Promise<AccessRequest | null> {
    const [row] = await this.db
      .select()
      .from(schema.accessRequests)
      .where(eq(schema.accessRequests.id, id))
      .limit(1);
    return row ? toRequest(row) : null;
  }

  async submit(
    userId: string,
    email: string,
    kind: AccessRequestKind,
  ): Promise<AccessRequestSubmission> {
    return this.db.transaction(async (tx) => {
      // Lock the owner row so submissions and approvals cannot race on one chat.
      const [owner] = await tx
        .select({ id: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, userId))
        .for('update');
      if (!owner) throw new Error('Access request owner does not exist');

      const [existing] = await tx
        .select()
        .from(schema.accessRequests)
        .where(
          and(
            eq(schema.accessRequests.userId, userId),
            eq(schema.accessRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (existing?.email === email && existing.kind === kind) {
        return { request: toRequest(existing), previousEmail: null, created: false };
      }
      const previousEmail = existing?.email ?? null;
      if (existing) {
        await tx
          .update(schema.accessRequests)
          .set({ status: 'superseded' })
          .where(eq(schema.accessRequests.id, existing.id));
      }
      if (kind === 'replacement') {
        await tx
          .update(schema.accessRequests)
          .set({ status: 'superseded' })
          .where(
            and(
              eq(schema.accessRequests.userId, userId),
              eq(schema.accessRequests.kind, 'replacement'),
              eq(schema.accessRequests.status, 'approved'),
              isNull(schema.accessRequests.activatedAt),
            ),
          );
      }
      const [created] = await tx
        .insert(schema.accessRequests)
        .values({ userId, email, kind })
        .returning();
      if (!created) throw new Error('Failed to create access request');
      return { request: toRequest(created), previousEmail, created: true };
    });
  }

  async approve(id: string, actor: string): Promise<AccessApprovalOutcome> {
    return this.db.transaction(async (tx) => {
      const [target] = await tx
        .select()
        .from(schema.accessRequests)
        .where(eq(schema.accessRequests.id, id))
        .limit(1);
      if (!target) return { status: 'not_found' };
      const [owner] = await tx
        .select({ id: schema.users.userId })
        .from(schema.users)
        .where(eq(schema.users.userId, target.userId))
        .for('update');
      if (!owner) return { status: 'not_found' };
      const [lockedTarget] = await tx
        .select()
        .from(schema.accessRequests)
        .where(eq(schema.accessRequests.id, id))
        .for('update');
      if (!lockedTarget) return { status: 'not_found' };
      if (lockedTarget.status === 'approved')
        return { status: 'already_approved', request: toRequest(lockedTarget) };
      const [current] = await tx
        .select()
        .from(schema.accessRequests)
        .where(
          and(
            eq(schema.accessRequests.userId, target.userId),
            eq(schema.accessRequests.status, 'pending'),
          ),
        )
        .limit(1);
      if (current?.id !== id) return { status: 'not_current' };
      if (lockedTarget.kind === 'initial') {
        const [approved] = await tx
          .select({ id: schema.accessRequests.id })
          .from(schema.accessRequests)
          .where(
            and(
              eq(schema.accessRequests.userId, target.userId),
              eq(schema.accessRequests.status, 'approved'),
              isNotNull(schema.accessRequests.activatedAt),
            ),
          )
          .limit(1);
        if (approved) return { status: 'not_current' };
      }
      // Replacement approval authorizes candidate OAuth but leaves old association active.
      const [updated] = await tx
        .update(schema.accessRequests)
        .set({
          status: 'approved',
          decidedAt: new Date(),
          decidedBy: actor,
          ...(lockedTarget.kind === 'initial' ? { activatedAt: new Date() } : {}),
        })
        .where(eq(schema.accessRequests.id, id))
        .returning();
      if (!updated) throw new Error('Failed to approve access request');
      return { status: 'approved', request: toRequest(updated) };
    });
  }

  async markNotificationSent(id: string): Promise<void> {
    await this.db
      .update(schema.accessRequests)
      .set({ notificationSentAt: new Date() })
      .where(eq(schema.accessRequests.id, id));
  }

  async markApprovalNoticeSent(id: string): Promise<void> {
    await this.db
      .update(schema.accessRequests)
      .set({ approvalNoticeSentAt: new Date() })
      .where(eq(schema.accessRequests.id, id));
  }
}
