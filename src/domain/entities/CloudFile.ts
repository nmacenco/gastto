// LAYER: Domain
// Immutable value object representing a normalized cloud storage file.
// Validation is performed at construction time; invalid data cannot exist.

import { DomainValidationError } from '../errors/DomainValidationError';

export interface CloudFileProps {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedAt: Date;
}

export class CloudFile implements CloudFileProps {
  readonly id: string;
  readonly name: string;
  readonly mimeType: string;
  readonly modifiedAt: Date;

  constructor(props: CloudFileProps) {
    if (!props.id || props.id.trim().length === 0) {
      throw new DomainValidationError('id is required and cannot be empty');
    }
    if (!props.name || props.name.trim().length === 0) {
      throw new DomainValidationError('name is required and cannot be empty');
    }
    if (!props.mimeType || props.mimeType.trim().length === 0) {
      throw new DomainValidationError('mimeType is required and cannot be empty');
    }
    if (!props.modifiedAt) {
      throw new DomainValidationError('modifiedAt is required');
    }

    this.id = props.id;
    this.name = props.name;
    this.mimeType = props.mimeType;
    this.modifiedAt = new Date(props.modifiedAt.getTime());

    Object.freeze(this);
  }

  equals(other: CloudFile): boolean {
    return (
      this.id === other.id &&
      this.name === other.name &&
      this.mimeType === other.mimeType &&
      this.modifiedAt.getTime() === other.modifiedAt.getTime()
    );
  }
}
