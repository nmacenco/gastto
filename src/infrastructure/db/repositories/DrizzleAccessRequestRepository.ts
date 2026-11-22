import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Logger } from 'pino';
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
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly logger: Logger,
  ) {}

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
    this.logger.info({
      msg: 'Access request database transaction started',
      endpoint: 'DrizzleAccessRequestRepository.submit',
      code: 'ACCESS_REQUEST_DB_SUBMIT_STARTED',
      userId,
      kind,
    });
    try {
      const result = await this.db.transaction(async (tx) => {
        // Lock the owner row so submissions and approvals cannot race on one chat.
        const [owner] = await tx
          .select({ id: schema.users.userId })
          .from(schema.users)
          .where(eq(schema.users.userId, userId))
          .for('update');
        if (!owner) throw new Error('Access request owner does not exist');
        const [deleting] = await tx
          .select({ userId: schema.accountDeletionOperations.userId })
          .from(schema.accountDeletionOperations)
          .where(eq(schema.accountDeletionOperations.userId, userId))
          .limit(1);
        if (deleting) throw new Error('ACCOUNT_ACCESS_REQUEST_BLOCKED');

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
      this.logger.info({
        msg: 'Access request database transaction committed',
        endpoint: 'DrizzleAccessRequestRepository.submit',
        code: 'ACCESS_REQUEST_DB_SUBMIT_COMMITTED',
        userId,
        kind,
        requestId: result.request.id,
        created: result.created,
      });
      return result;
    } catch (error) {
      this.logger.error({
        msg: 'Access request database transaction failed',
        endpoint: 'DrizzleAccessRequestRepository.submit',
        code: 'ACCESS_REQUEST_DB_SUBMIT_FAILED',
        userId,
        kind,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
      throw error;
    }
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
      const [deleting] = await tx
        .select({ userId: schema.accountDeletionOperations.userId })
        .from(schema.accountDeletionOperations)
        .where(eq(schema.accountDeletionOperations.userId, target.userId))
        .limit(1);
      if (deleting) return { status: 'not_found' };
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
    this.logger.info({
      msg: 'Access request notification database update started',
      endpoint: 'DrizzleAccessRequestRepository.markNotificationSent',
      code: 'ACCESS_REQUEST_DB_NOTICE_UPDATE_STARTED',
      requestId: id,
    });
    let affectedRows: number | null = null;
    try {
      const updated = await this.db
        .update(schema.accessRequests)
        .set({ notificationSentAt: new Date() })
        .where(eq(schema.accessRequests.id, id))
        .returning({ id: schema.accessRequests.id });
      affectedRows = updated.length;
      if (affectedRows !== 1) {
        throw new Error('Access request notification update matched no row');
      }
      this.logger.info({
        msg: 'Access request notification database update committed',
        endpoint: 'DrizzleAccessRequestRepository.markNotificationSent',
        code: 'ACCESS_REQUEST_DB_NOTICE_UPDATE_COMMITTED',
        requestId: id,
        affectedRows,
      });
    } catch (error) {
      this.logger.error({
        msg: 'Access request notification database update failed',
        endpoint: 'DrizzleAccessRequestRepository.markNotificationSent',
        code: 'ACCESS_REQUEST_DB_NOTICE_UPDATE_FAILED',
        requestId: id,
        affectedRows,
        errorType: error instanceof Error ? error.constructor.name : 'unknown',
      });
      throw error;
    }
  }

  async markApprovalNoticeSent(id: string): Promise<void> {
    await this.db
      .update(schema.accessRequests)
      .set({ approvalNoticeSentAt: new Date() })
      .where(eq(schema.accessRequests.id, id));
  }
}
