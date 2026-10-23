import { EventKind, PriorityTier } from '@prisma/client';
import { NormalizationError, NormalizedReading, TypeStrategy } from './normalized-reading';

// POSITION_APP: latitude_i and longitude_i in 1e-7 degrees, altitude in metres when non-zero
// (MeshPacketSerializer.cpp:208-250). P1_LOCATION inside an open episode is decided by `incidents`.
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
