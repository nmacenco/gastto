import {
  SemanticRolloutObservationSchema,
  type SemanticRolloutObservation,
} from '../../use-cases/evaluation/release-contracts';

export interface SemanticRolloutTelemetryPort {
  recordRollout(observation: SemanticRolloutObservation): void;
}

/**
 * Validates the aggregate release event at the application boundary. Callers must
 * supply only the allowlisted aggregate fields; identity and message fields are not
 * part of the accepted contract.
 */
export class RecordSemanticRolloutObservation {
  constructor(private readonly telemetry: SemanticRolloutTelemetryPort) {}

  execute(observation: SemanticRolloutObservation): boolean {
    const parsed = SemanticRolloutObservationSchema.safeParse(observation);
    if (!parsed.success) return false;
    try {
      this.telemetry.recordRollout(parsed.data);
      return true;
    } catch {
      return false;
    }
  }
}
