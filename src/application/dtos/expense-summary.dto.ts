// LAYER: Application
// Data transfer object for the interpreted expense summary shown to the user
// before saving. This is a plain, channel-agnostic payload; the presenter
// decides how to render confidence markers, date labels, and action options.

export type CategoryConfidence = 'alta' | 'baja' | 'nula';

export type CategoryStatus = 'confirmed' | 'ambiguous' | 'fallback' | 'none';

export interface ExpenseSummary {
  concept: string;
  amount: number;
  currency: string;
  category: string;
  date: string;
  categoryConfidence: CategoryConfidence;
  categoryStatus: CategoryStatus;
  actions: {
    confirm: true;
    correct: true;
    cancel: true;
  };
  isHighAmount: boolean;
  requiresExplicitConfirmation: boolean;
}
