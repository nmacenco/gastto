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
    if (parsed.success) this.logger.info(parsed.data);
  }
}
