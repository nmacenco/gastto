import { createHmac } from 'node:crypto';
import type { Redis } from 'ioredis';

// A bounded replay marker for /start. The key reveals neither the chat ID nor
// the message ID without the runtime secret, and expires after 48 hours.
export class RedisStartReplayGuard {
  constructor(
    private readonly redis: Redis,
    private readonly keyMaterial: string,
  ) {}

  private key(chatId: string, messageId: string): string {
    const digest = createHmac('sha256', this.keyMaterial)
      .update(`telegram:${chatId}:${messageId}`)
      .digest('hex');
    return `account-start-replay:${digest}`;
  }

  async claim(chatId: string, messageId: string): Promise<boolean> {
    return (await this.redis.set(this.key(chatId, messageId), '1', 'EX', 172_800, 'NX')) === 'OK';
  }

  async release(chatId: string, messageId: string): Promise<void> {
    await this.redis.del(this.key(chatId, messageId));
  }
}
