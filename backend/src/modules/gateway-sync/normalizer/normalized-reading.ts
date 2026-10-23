import { EventKind, PriorityTier } from '@prisma/client';

export interface NormalizedReading {
  kind: EventKind;
  priority: PriorityTier;
  position?: { latitude: number; longitude: number; altitude?: number };
  batteryPct?: number;
}

export interface TypeStrategy {
  normalize(payload: Record<string, unknown>): NormalizedReading;
}

export class NormalizationError extends Error {}
