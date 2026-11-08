import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { env } from '../../config/env';
import { createLogger } from '../../infrastructure/logger';
import { DrizzleAccessRequestRepository } from '../../infrastructure/db/repositories/DrizzleAccessRequestRepository';
import { DrizzleUserRepository } from '../../infrastructure/db/repositories/DrizzleUserRepository';
import { TelegramMessengerAdapter } from '../../infrastructure/adapters/telegram/TelegramMessengerAdapter';
import { ApproveAccessRequest } from '../../application/use-cases/user/ApproveAccessRequest';
import { Redis } from 'ioredis';
import * as schema from '../../infrastructure/db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function approveAccessRequestCli(requestId: string): Promise<number> {
  if (!UUID.test(requestId)) {
    process.stderr.write('Expected a valid access request UUID.\n');
    return 2;
  }
  if (!env.ACCESS_APPROVAL_ENABLED) {
    process.stderr.write('Access approval is disabled in this deployment.\n');
    return 2;
  }
  const logger = createLogger({ level: env.LOG_LEVEL, pretty: false });
  const sql = postgres(env.DATABASE_URL);
  const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  try {
    const db = drizzle(sql, { schema });
    const requests = new DrizzleAccessRequestRepository(db);
    const users = new DrizzleUserRepository(db, redis);
    const telegram = new TelegramMessengerAdapter(env.TELEGRAM_BOT_TOKEN, logger);
    const useCase = new ApproveAccessRequest(requests, users, telegram);
    const outcome = await useCase.execute({ requestId, operatorIdentity: 'project-owner' });
    logger.info({ msg: 'Access approval CLI completed', requestId, outcome: outcome.status });
    return outcome.status === 'not_current' || outcome.status === 'not_found' ? 2 : 0;
  } catch (error) {
    logger.error({
      msg: 'Access approval CLI failed',
      endpoint: 'approveAccessRequestCli',
      code: 'ACCESS_APPROVAL_FAILED',
      requestId,
      errorType: error instanceof Error ? error.constructor.name : 'unknown',
    });
    return 1;
  } finally {
    await Promise.allSettled([sql.end(), redis.quit()]);
  }
}

if (typeof require !== 'undefined' && require.main === module) {
  void approveAccessRequestCli(process.argv[2] ?? '').then((code) => {
    process.exitCode = code;
  });
}
