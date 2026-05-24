// LAYER: Domain
// Immutable value object representing a normalized incoming text message.
// Validation is performed at construction time; invalid data cannot exist.

import type { MessageType } from './MessageType';
import { DomainValidationError } from '../errors/DomainValidationError';

export interface IncomingMessageProps {
  readonly chatId: string;
  readonly userId: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly channel: 'telegram' | 'whatsapp';
}

export class IncomingMessage implements IncomingMessageProps {
  readonly chatId: string;
  readonly userId: string;
  readonly text: string;
  readonly timestamp: Date;
  readonly channel: 'telegram' | 'whatsapp';

  constructor(props: IncomingMessageProps) {
    if (!props.chatId || props.chatId.trim().length === 0) {
      throw new DomainValidationError('chatId is required and cannot be empty');
    }
    if (!props.userId || props.userId.trim().length === 0) {
      throw new DomainValidationError('userId is required and cannot be empty');
    }
    if (!props.text || props.text.trim().length === 0) {
      throw new DomainValidationError('text is required and cannot be empty');
    }
    if (!props.timestamp) {
      throw new DomainValidationError('timestamp is required');
    }
    if (props.channel !== 'telegram' && props.channel !== 'whatsapp') {
      throw new DomainValidationError('channel must be "telegram" or "whatsapp"');
    }

    this.chatId = props.chatId;
    this.userId = props.userId;
    this.text = props.text;
    this.timestamp = new Date(props.timestamp.getTime());
    this.channel = props.channel;

    Object.freeze(this);
  }

  get messageType(): MessageType {
    return 'TEXT';
  }

  equals(other: IncomingMessage): boolean {
    return (
      this.messageType === other.messageType &&
      this.chatId === other.chatId &&
      this.userId === other.userId &&
      this.text === other.text &&
      this.timestamp.getTime() === other.timestamp.getTime() &&
      this.channel === other.channel
    );
  }
}
