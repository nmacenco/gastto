// LAYER: Infrastructure. Metadata-only semantic routing telemetry.
import type { Logger } from 'pino';
import type {
  SemanticRoutingObservation,
  SemanticRoutingTelemetryPort,
} from '../../application/services/semantic-router/ObserveSemanticRouting';
import { SemanticRoutingObservationSchema } from '../../application/services/semantic-router/ObserveSemanticRouting';
import type { SemanticRolloutTelemetryPort } from '../../application/services/semantic-router/rollout-telemetry';
import {
  SemanticRolloutObservationSchema,
  type SemanticRolloutObservation,
} from '../../application/use-cases/evaluation/release-contracts';

export class PinoSemanticRoutingTelemetry
  implements SemanticRoutingTelemetryPort, SemanticRolloutTelemetryPort
{
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

  recordRollout(observation: SemanticRolloutObservation): void {
    const parsed = SemanticRolloutObservationSchema.safeParse(observation);
    if (!parsed.success) return;
    try {
      this.logger.info({ event: 'semantic_rollout_observation', ...parsed.data });
    } catch {
      try {
        this.logger.error({
          msg: 'Failed to record semantic rollout telemetry',
          endpoint: 'PinoSemanticRoutingTelemetry.recordRollout',
          code: 'SEMANTIC_ROLLOUT_TELEMETRY_FAILED',
        });
      } catch {
        // Release observability cannot change application behavior.
      }
    }
  }
}
