// LAYER: Infrastructure. Metadata-only semantic routing telemetry.
import type { Logger } from 'pino';
import type {
  SemanticRoutingObservation,
  SemanticRoutingTelemetryPort,
} from '../../application/services/semantic-router/ObserveSemanticRouting';
import { SemanticRoutingObservationSchema } from '../../application/services/semantic-router/ObserveSemanticRouting';

export class PinoSemanticRoutingTelemetry implements SemanticRoutingTelemetryPort {
  constructor(private readonly logger: Logger) {}

  record(observation: SemanticRoutingObservation): void {
    const parsed = SemanticRoutingObservationSchema.safeParse(observation);
    if (!parsed.success) return;
    try {
      this.logger.info(parsed.data);
    } catch {
      try {
        this.logger.error({
          msg: 'Failed to record semantic routing telemetry',
          endpoint: 'PinoSemanticRoutingTelemetry.record',
          code: 'SEMANTIC_TELEMETRY_FAILED',
        });
      } catch {
        // Observability failure must remain non-fatal to deterministic processing.
      }
    }
  }
}
