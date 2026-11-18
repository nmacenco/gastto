// LAYER: Infrastructure
// Concrete IUserRepository implementation using Drizzle ORM.
// Applies Redis cache for (channel, externalId) → userId resolution (ADR-008).

import { eq, and } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import type { Redis } from 'ioredis';
import { users, messagingIdentities, accountDeletionOperations } from '../schema';
import type * as schema from '../schema';
import type { IUserRepository } from '../../../domain/ports/repositories';
import type { User, MessagingIdentity } from '../../../domain/entities/User';

const IDENTITY_CACHE_TTL = 60 * 60 * 24; // 24 horas (ADR-008)

export class DrizzleUserRepository implements IUserRepository {
  constructor(
    private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly redis: Redis,
  ) {}

  async findById(userId: string): Promise<User | null> {
    const [row] = await this.db.select().from(users).where(eq(users.userId, userId)).limit(1);

    return row ? this.mapUser(row) : null;
  }

  async findByMessagingIdentity(
    channel: 'telegram' | 'whatsapp',
    externalId: string,
  ): Promise<User | null> {
    const cacheKey = `identity:${channel}:${externalId}`;

    // 1. Resolve a cached ID, but verify the user and deletion barrier in DB.
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const user = await this.findById(cached);
      if (!user) {
        await this.redis.del(cacheKey);
        return null;
      }
      const [deleting] = await this.db
        .select({ userId: accountDeletionOperations.userId })
        .from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, cached))
        .limit(1);
      return deleting ? null : user;
    }

    // Share-lock the owner until the cache write finishes. Deletion begins
    // under an exclusive owner lock, so it either sees and clears this key or
    // this lookup sees the durable deletion barrier and cannot repopulate it.
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .select({ user: users })
        .from(messagingIdentities)
        .innerJoin(users, eq(messagingIdentities.userId, users.userId))
        .where(
          and(
            eq(messagingIdentities.channel, channel),
            eq(messagingIdentities.externalId, externalId),
          ),
        )
        .for('share')
        .limit(1);

      if (!row) return null;
      const [deleting] = await tx
        .select({ userId: accountDeletionOperations.userId })
        .from(accountDeletionOperations)
        .where(eq(accountDeletionOperations.userId, row.user.userId))
        .limit(1);
      if (deleting) return null;

      await this.redis.setex(cacheKey, IDENTITY_CACHE_TTL, row.user.userId);
      return this.mapUser(row.user);
    });
  }

  async createWithIdentity(
    channel: 'telegram' | 'whatsapp',
    externalId: string,
  ): Promise<{ user: User; identity: MessagingIdentity }> {
    // Transaction: User + MessagingIdentity in a single atomic block
    return this.db.transaction(async (tx) => {
      const [newUser] = await tx
        .insert(users)
        .values({ status: 'onboarding', defaultCurrency: null })
        .returning();
      if (!newUser) throw new Error('Failed to create user');

      const [newIdentity] = await tx
        .insert(messagingIdentities)
        .values({ userId: newUser.userId, channel, externalId })
        .returning();
      if (!newIdentity) throw new Error('Failed to create messaging identity');

      // Populate cache immediately
      const cacheKey = `identity:${channel}:${externalId}`;
      await this.redis.setex(cacheKey, IDENTITY_CACHE_TTL, newUser.userId);

      return {
        user: this.mapUser(newUser),
        identity: this.mapIdentity(newIdentity),
      };
    });
  }

  async updateStatus(userId: string, status: User['status']): Promise<void> {
    await this.db
      .update(users)
      .set({ status, updatedAt: new Date() })
      .where(eq(users.userId, userId));
  }

  async updateDefaultCurrency(userId: string, currency: User['defaultCurrency']): Promise<void> {
    await this.db
      .update(users)
      .set({ defaultCurrency: currency, updatedAt: new Date() })
      .where(eq(users.userId, userId));
  }

  async findMessagingIdentitiesByUserId(userId: string): Promise<MessagingIdentity[]> {
    const rows = await this.db
      .select()
      .from(messagingIdentities)
      .where(eq(messagingIdentities.userId, userId));

    return rows.map((row) => this.mapIdentity(row));
  }

  // ── Mappers ────────────────────────────────────────────────────────────────

  private mapUser(row: typeof users.$inferSelect): User {
    return {
      userId: row.userId,
      status: row.status as User['status'],
      defaultCurrency: row.defaultCurrency as User['defaultCurrency'],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private mapIdentity(row: typeof messagingIdentities.$inferSelect): MessagingIdentity {
    return {
      id: row.id,
      userId: row.userId,
      channel: row.channel as 'telegram' | 'whatsapp',
      externalId: row.externalId,
      linkedAt: row.linkedAt,
    };
  }
}
