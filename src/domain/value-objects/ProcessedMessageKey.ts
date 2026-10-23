// LAYER: Domain
// Immutable value object representing a unique key for idempotent message processing.
// Combines the external channel with the channel-specific message ID so the same
// physical message cannot be processed twice.

import { DomainValidationError } from '../errors/DomainValidationError';

export interface ProcessedMessageKeyProps {
  readonly channel: 'telegram' | 'whatsapp';
  readonly externalMessageId: string;
}

export class ProcessedMessageKey implements ProcessedMessageKeyProps {
  readonly channel: 'telegram' | 'whatsapp';
  readonly externalMessageId: string;

  constructor(props: ProcessedMessageKeyProps) {
    if (props.channel !== 'telegram' && props.channel !== 'whatsapp') {
      throw new DomainValidationError('channel must be "telegram" or "whatsapp"');
    }
    if (!props.externalMessageId || props.externalMessageId.trim().length === 0) {
      throw new DomainValidationError('externalMessageId is required and cannot be empty');
    }

    this.channel = props.channel;
    this.externalMessageId = props.externalMessageId;

    Object.freeze(this);
  }

  equals(other: ProcessedMessageKey): boolean {
    return this.channel === other.channel && this.externalMessageId === other.externalMessageId;
  }
}
