import { EventKind, PriorityTier } from '@prisma/client';
import { NormalizationError, NormalizedReading, TypeStrategy } from './normalized-reading';

// POSITION_APP: latitude_i and longitude_i in 1e-7 degrees, altitude in metres when non-zero
// (MeshPacketSerializer.cpp:208-250). Every position is stored as P2_GPS: no code assigns P1_LOCATION yet, so the
// P1 tier of FR-EVT-02 is not implemented (TanNB's SRS status check, capstone#61).
export class PositionStrategy implements TypeStrategy {
  normalize(payload: Record<string, unknown>): NormalizedReading {
    const { latitude_i: lat, longitude_i: lon, altitude } = payload;
    if (!Number.isInteger(lat) || !Number.isInteger(lon)) {
      throw new NormalizationError('position payload has no integer latitude_i and longitude_i');
    }
    return {
      kind: EventKind.POSITION,
      priority: PriorityTier.P2_GPS,
      position: {
        latitude: (lat as number) / 1e7,
        longitude: (lon as number) / 1e7,
        ...(typeof altitude === 'number' ? { altitude } : {}),
      },
    };
  }
}
