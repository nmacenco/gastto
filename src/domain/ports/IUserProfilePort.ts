// LAYER: Domain
// Port for retrieving user profile fields used by application use cases.
// Kept separate from IUserRepository so read-only profile lookups can be
// mocked independently in unit tests.

import type { Currency } from '../entities/User';

export interface IUserProfilePort {
  getDefaultCurrency(userId: string): Promise<Currency | null>;
}
