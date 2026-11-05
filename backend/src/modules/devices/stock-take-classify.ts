import { DeviceStatus } from '@prisma/client';

// The classification of a stock-take (devices design section 11), pure so the service and the demo seed
// share it.

export interface CountedDevice {
  id: string;
  assetTag: string;
  status: DeviceStatus;
  lastSeenAt: Date | null;
}

export interface UnconfirmedUnit {
  id: string;
  assetTag: string;
  status: DeviceStatus;
  lastSeenAt: string | null;
}

// The stored `result` JSON of a run, and the answer of api-design 25 with the run's id and time.
export interface StockTakeResult {
  scannedCount: number;
  inStockConfirmed: number;
  rentedSeen: number;
  unconfirmed: UnconfirmedUnit[];
  unknownTags: string[];
}

// REQ-EVT-30 (design section 11): a scanned unit is confirmed whatever its status; a RENTED unit not
// scanned is confirmed when heard within the window; every other unit is unconfirmed; a scanned tag
// matching no counted unit is unknown. Tags arrive trimmed and upper-cased from the DTO.
export const classify = (
  devices: readonly CountedDevice[],
  scannedTags: readonly string[],
  seenSince: Date,
): StockTakeResult => {
  const scanned = new Set(scannedTags);
  const known = new Set<string>();
  let inStockConfirmed = 0;
  let rentedSeen = 0;
  const unconfirmed: UnconfirmedUnit[] = [];
  for (const device of devices) {
    const tag = device.assetTag.toUpperCase();
    known.add(tag);
    if (scanned.has(tag)) {
      inStockConfirmed += 1;
    } else if (
      device.status === DeviceStatus.RENTED &&
      device.lastSeenAt !== null &&
      device.lastSeenAt.getTime() >= seenSince.getTime()
    ) {
      rentedSeen += 1;
    } else {
      unconfirmed.push({
        id: device.id,
        assetTag: device.assetTag,
        status: device.status,
        lastSeenAt: device.lastSeenAt?.toISOString() ?? null,
      });
    }
  }
  return {
    scannedCount: scanned.size,
    inStockConfirmed,
    rentedSeen,
    unconfirmed,
    unknownTags: [...scanned].filter((tag) => !known.has(tag)),
  };
};
