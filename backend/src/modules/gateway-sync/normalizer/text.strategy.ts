import { EventKind, PriorityTier } from '@prisma/client';
import { NormalizationError, NormalizedReading, TypeStrategy } from './normalized-reading';

// The SOS strings of TrekLinkSOSHelper.h:19-20 (FGT §2). The fall prefix starts with the plain one, so it
// is tested first (REQ-EVT-02).
export const SOS_PREFIX = 'SOS - ';
export const FALL_SOS_PREFIX = 'SOS - FALL DETECTED';

export class TextStrategy implements TypeStrategy {
  normalize(payload: Record<string, unknown>): NormalizedReading {
    const text = payload.text;
    if (typeof text !== 'string') throw new NormalizationError('text payload has no text');
    if (text.startsWith(FALL_SOS_PREFIX))
      return { kind: EventKind.FALL_SOS, priority: PriorityTier.P0_SOS };
    if (text.startsWith(SOS_PREFIX)) return { kind: EventKind.SOS, priority: PriorityTier.P0_SOS };
    return { kind: EventKind.CHAT, priority: PriorityTier.P3_TELEMETRY };
  }
}
