// LAYER: Domain
// Immutable value object representing a sheet inside a spreadsheet file.
// Validation is performed at construction time; invalid data cannot exist.

import { DomainValidationError } from '../errors/DomainValidationError';

export interface SheetInfoProps {
  readonly name: string;
  readonly index: number;
}

export class SheetInfo implements SheetInfoProps {
  readonly name: string;
  readonly index: number;

  constructor(props: SheetInfoProps) {
    if (!props.name || props.name.trim().length === 0) {
      throw new DomainValidationError('name is required and cannot be empty');
    }
    if (typeof props.index !== 'number' || props.index < 0 || !Number.isInteger(props.index)) {
      throw new DomainValidationError('index must be a non-negative integer');
    }

    this.name = props.name.trim();
    this.index = props.index;

    Object.freeze(this);
  }

  equals(other: SheetInfo): boolean {
    return this.name === other.name && this.index === other.index;
  }
}
