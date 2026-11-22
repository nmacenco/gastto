import { IncomingMessageJobDataSchema } from '../../application/ports/IncomingMessageJob';
import { OAuthReminderJobDataSchema } from '../../application/ports/OAuthReminderJob';
import { ProcessMessageJobDataSchema } from '../../application/ports/ProcessMessageJob';
import { SessionTimeoutJobDataSchema } from '../../application/ports/SessionTimeoutJob';

export type RestoredJobDecision =
  | 'orphaned'
  | 'pendingDeletion'
  | 'completedHistory'
  | 'failedHistory'
  | 'unresolved'
  | 'global'
  | 'invalidPayload';

export interface RestoredJobContext {
  liveUsers: ReadonlySet<string>;
  deletingUsers: ReadonlySet<string>;
  ownerByIdentity: ReadonlyMap<string, string>;
}

/** Classification is advisory; none of these decisions authorize automatic replay. */
export function classifyRestoredJob(
  queueName: string,
  data: unknown,
  state: string,
  context: RestoredJobContext,
): RestoredJobDecision {
  if (queueName === 'session-timeout') {
    return SessionTimeoutJobDataSchema.safeParse(data).success ? 'global' : 'invalidPayload';
  }
  if (queueName === 'account-deletion') {
    if (
      typeof data !== 'object' ||
      data === null ||
      !('userId' in data) ||
      typeof data.userId !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(data.userId)
    ) {
      return 'invalidPayload';
    }
    return context.deletingUsers.has(data.userId) ? 'pendingDeletion' : 'orphaned';
  }

  let userId: string;
  let identityKey: string;
  if (queueName === 'incoming-message') {
    const parsed = IncomingMessageJobDataSchema.safeParse(data);
    if (!parsed.success) return 'invalidPayload';
    if (!parsed.data.userId) return 'unresolved';
    userId = parsed.data.userId;
    identityKey = `identity:${parsed.data.channel}:${parsed.data.chatId}`;
  } else if (queueName === 'process-message') {
    const parsed = ProcessMessageJobDataSchema.safeParse(data);
    if (!parsed.success) return 'invalidPayload';
    userId = parsed.data.userId;
    identityKey = `identity:${parsed.data.channel}:${parsed.data.externalId}`;
  } else if (queueName === 'oauth-reminder') {
    const parsed = OAuthReminderJobDataSchema.safeParse(data);
    if (!parsed.success) return 'invalidPayload';
    userId = parsed.data.userId;
    identityKey = `identity:${parsed.data.channel}:${parsed.data.externalId}`;
  } else {
    return 'invalidPayload';
  }

  if (
    !context.liveUsers.has(userId) ||
    context.deletingUsers.has(userId) ||
    context.ownerByIdentity.get(identityKey) !== userId
  ) {
    return 'orphaned';
  }
  if (state === 'completed') return 'completedHistory';
  if (state === 'failed') return 'failedHistory';
  return 'unresolved';
}
