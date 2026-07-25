// LAYER: Infrastructure
// IUserProfilePort implementation that delegates to the existing user
// repository. Keeps application use cases agnostic of storage details.

import type { IUserProfilePort } from '../../../domain/ports/IUserProfilePort';
import type { Currency } from '../../../domain/entities/User';
import type { DrizzleUserRepository } from './DrizzleUserRepository';

export class DrizzleUserProfileRepository implements IUserProfilePort {
  constructor(private readonly userRepository: DrizzleUserRepository) {}

  async getDefaultCurrency(userId: string): Promise<Currency | null> {
    const user = await this.userRepository.findById(userId);
    return user?.defaultCurrency ?? null;
  }
}
