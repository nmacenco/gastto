import type { IUserProcessingLock } from '../ports/UserProcessingLock';
import type { MessagingOutputPort } from '../ports/output/messaging.port';
import type { RevokeAccountCredentials } from '../use-cases/user/RevokeAccountCredentials';

export interface AccountDeletionProgressPort {
  get(userId: string): Promise<{ stage: string; remoteRevocationFailed: boolean } | null>;
  assertWorkDrained(userId: string): Promise<void>;
  identities(userId: string): Promise<Array<{ channel: string; externalId: string }>>;
  setStage(
    userId: string,
    stage: 'revoking' | 'cleaning' | 'notifying',
    remoteRevocationFailed?: boolean,
  ): Promise<void>;
  eraseAccount(userId: string): Promise<void>;
  finish(userId: string): Promise<void>;
}

export interface AccountOperationalCleanupPort {
  clean(
    userId: string,
    identities: readonly { channel: string; externalId: string }[],
  ): Promise<void>;
}

export class AccountDeletionService {
  constructor(
    private readonly progress: AccountDeletionProgressPort,
    private readonly credentials: RevokeAccountCredentials,
    private readonly cleanup: AccountOperationalCleanupPort,
    private readonly lock: IUserProcessingLock,
    private readonly messaging: MessagingOutputPort,
  ) {}

  async resume(userId: string): Promise<void> {
    const token = await this.lock.acquire(userId, 180_000);
    if (!token) throw new Error('ACCOUNT_DELETION_LOCK_BUSY');
    let leaseValid = true;
    let renewing = false;
    const timer = setInterval(() => {
      if (renewing) return;
      renewing = true;
      void this.lock
        .renew(userId, token, 180_000)
        .then((valid) => {
          if (!valid) leaseValid = false;
        })
        .catch(() => {
          leaseValid = false;
        })
        .finally(() => {
          renewing = false;
        });
    }, 60_000);
    timer.unref();
    const assertLease = () => {
      if (!leaseValid) throw new Error('ACCOUNT_DELETION_LOCK_LOST');
    };
    try {
      let state = await this.progress.get(userId);
      if (!state) return;
      await this.progress.assertWorkDrained(userId);
      const identities = await this.progress.identities(userId);
      if (state.stage === 'blocked' || state.stage === 'revoking') {
        assertLease();
        await this.progress.setStage(userId, 'revoking', true);
        const result = await this.credentials.execute(userId);
        assertLease();
        await this.progress.setStage(
          userId,
          'cleaning',
          result.credentialsPresent ? result.remoteRevocationFailed : state.remoteRevocationFailed,
        );
        state = await this.progress.get(userId);
        if (!state) return;
      }
      if (state.stage === 'cleaning') {
        assertLease();
        await this.cleanup.clean(userId, identities);
        assertLease();
        await this.progress.eraseAccount(userId);
        assertLease();
        await this.cleanup.clean(userId, identities);
        await this.progress.setStage(userId, 'notifying');
        state = await this.progress.get(userId);
        if (!state) return;
      }
      if (state.stage === 'notifying') {
        assertLease();
        const text = state.remoteRevocationFailed
          ? 'Gastto eliminó tu cuenta y sus credenciales locales, pero no pudo confirmar la revocación en Google. Puedes retirar el acceso de Gastto desde las conexiones de tu cuenta de Google. La eliminación no modificó tu hoja de cálculo.'
          : 'Tu cuenta y los datos internos de Gastto se han eliminado. La eliminación no modificó tu hoja de cálculo.';
        const telegram = identities.find((identity) => identity.channel === 'telegram');
        if (telegram) {
          try {
            await this.messaging.sendMessage(telegram.externalId, text);
          } catch {
            // Delivery failure cannot restore the account or retain identifiers indefinitely.
          }
        }
        await this.progress.finish(userId);
      }
    } finally {
      clearInterval(timer);
      await this.lock.release(userId, token);
    }
  }
}
