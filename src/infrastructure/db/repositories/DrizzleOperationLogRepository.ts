// LAYER: Infrastructure
// Concrete IOperationLogRepository implementation using Drizzle ORM.
// Maps between schema row shape and domain OperationLog entity.

import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { operationLogs } from '../schema';
import type * as schema from '../schema';
import type { IOperationLogRepository } from '../../../domain/ports/repositories';
import type { OperationLog, OperationType, ErrorType } from '../../../domain/entities/OperationLog';

export class DrizzleOperationLogRepository implements IOperationLogRepository {
  constructor(private readonly db: PostgresJsDatabase<typeof schema>) {}

  async create(
    userId: string,
    operation: OperationType,
    payload?: Record<string, unknown>,
    errorType?: ErrorType,
  ): Promise<OperationLog> {
    const [row] = await this.db
      .insert(operationLogs)
      .values({
        userId,
        operation,
        payload: payload ?? null,
        errorType: errorType ?? null,
      })
      .returning();

    if (!row) throw new Error('Failed to create operation log');

    return this.mapOperationLog(row);
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapOperationLog(row: typeof operationLogs.$inferSelect): OperationLog {
    return {
      id: row.id,
      userId: row.userId,
      operation: row.operation as OperationType,
      payload: (row.payload as Record<string, unknown> | null) ?? null,
      errorType: (row.errorType as ErrorType | null) ?? null,
      createdAt: row.createdAt,
    };
  }
}
