import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../../config/env';
import { createLogger } from '../../infrastructure/logger';
import { DrizzleAccessRequestRepository } from '../../infrastructure/db/repositories/DrizzleAccessRequestRepository';
import { DrizzleUserRepository } from '../../infrastructure/db/repositories/DrizzleUserRepository';
import { GmailOperatorMailAdapter } from '../../infrastructure/adapters/gmail/GmailOperatorMailAdapter';
import { operatorMailFailureContext } from '../../application/ports/OperatorMailPort';
import * as schema from '../../infrastructure/db/schema';
import { Redis } from 'ioredis';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function notifyAccessRequestCli(requestId: string): Promise<number> {
  if (!UUID.test(requestId) || !env.ACCESS_APPROVAL_ENABLED) return 2;
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: false });
  const sql = postgres(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  try {
    const db = drizzle(sql, { schema });
    const requests = new DrizzleAccessRequestRepository(db);
    const users = new DrizzleUserRepository(db, redis);
    const request = await requests.findById(requestId);
    if (!request || request.status !== 'pending') return 2;
    if (request.notificationSentAt) return 0;
    const active =
      request.kind === 'replacement' ? await requests.findApproved(request.userId) : null;
    const chat = (await users.findMessagingIdentitiesByUserId(request.userId)).find(
      (identity) => identity.channel === 'telegram',
    );
    if (!chat) return 2;
    const mail = new GmailOperatorMailAdapter({
      sender: env.ADMIN_GMAIL_ADDRESS!,
      recipient: env.ADMIN_NOTIFICATION_EMAIL!,
      clientId: env.ADMIN_GMAIL_CLIENT_ID!,
      clientSecret: env.ADMIN_GMAIL_CLIENT_SECRET!,
      refreshToken: env.ADMIN_GMAIL_REFRESH_TOKEN!,
    });
    await mail.sendAccessRequestNotice({
      requestId,
      chatId: chat.externalId,
      email: request.email,
      kind: request.kind,
      previousEmail: active?.email ?? null,
    });
    await requests.markNotificationSent(requestId);
    logger.info({ msg: 'Operator notification sent', requestId });
    return 0;
  } catch (error) {
    logger.error({
      msg: 'Operator notification failed',
      endpoint: 'notifyAccessRequestCli',
      code: 'ACCESS_REQUEST_MAIL_FAILED',
      requestId,
      ...operatorMailFailureContext(error),
    });
    return 1;
  } finally {
    await Promise.allSettled([sql.end(), redis.quit()]);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void notifyAccessRequestCli(process.argv[2] ?? '').then((code) => {
    process.exitCode = code;
  });
}
