// LAYER: Application
// Service that classifies free-text expense intents.
// Thin, pure wrapper over the domain FreeTextIntent value object.
// No infrastructure or channel dependencies.

import { FreeTextIntent } from '../../../domain/value-objects/FreeTextIntent';

export class ClassifyFreeTextExpenseIntent {
  execute(text: string): FreeTextIntent {
    return FreeTextIntent.fromText(text);
  }
}
