// LAYER: Application
// Use case: resolve user identity from channel and external ID.
// Executed in Fastify handler BEFORE enqueuing BullMQ job (ADR-005).
// If user doesn't exist, creates and starts onboarding (ADR-008).

import type { IUserRepository } from '../../../domain/ports/repositories';
import type { IConversationStateRepository } from '../../../domain/ports/repositories';

export interface ResolveUserIdentityInput {
  channel: 'telegram' | 'whatsapp';
  externalId: string;
}

export interface ResolveUserIdentityOutput {
  userId: string;
  isNewUser: boolean;
  currentState: string;
}

export class ResolveUserIdentityUseCase {
  constructor(
    private readonly userRepo: IUserRepository,
    private readonly conversationRepo: IConversationStateRepository,
  ) {}

  async execute(input: ResolveUserIdentityInput): Promise<ResolveUserIdentityOutput> {
    const { channel, externalId } = input;

    // 1. Searches for existing user (repo applies Redis cache internally)
    const existingUser = await this.userRepo.findByMessagingIdentity(channel, externalId);

    if (existingUser) {
      const state = await this.conversationRepo.findByUserId(existingUser.userId);
      return {
        userId: existingUser.userId,
        isNewUser: false,
        currentState: state?.currentState ?? 'IDLE',
      };
    }

    // 2. New user: creates User + MessagingIdentity in transaction
    const { user } = await this.userRepo.createWithIdentity(channel, externalId);

    // 3. Estado inicial IDLE → ONBOARDING_START
    await this.conversationRepo.create(user.userId);
    await this.conversationRepo.transition(user.userId, 'ONBOARDING_START', { promptShown: false }, null);

    return {
      userId: user.userId,
      isNewUser: true,
      currentState: 'ONBOARDING_START',
    };
  }
}
