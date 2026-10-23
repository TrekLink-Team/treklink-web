import { Injectable } from '@nestjs/common';
import { IngestedType } from '../canonical-envelope';
import { NormalizedReading, TypeStrategy } from './normalized-reading';
import { PositionStrategy } from './position.strategy';
import { TelemetryStrategy } from './telemetry.strategy';
import { TextStrategy } from './text.strategy';

// Picks the strategy by the stock `type` (design §2). A strategy that throws is audited
// NORMALIZATION_FAILED by the caller, for that packet only (REQ-ERR-05).
@Injectable()
export class Normalizer {
  private readonly strategies: Record<IngestedType, TypeStrategy> = {
    text: new TextStrategy(),
    position: new PositionStrategy(),
    telemetry: new TelemetryStrategy(),
  };

  normalize(type: IngestedType, payload: Record<string, unknown>): NormalizedReading {
    return this.strategies[type].normalize(payload);
  }
}
