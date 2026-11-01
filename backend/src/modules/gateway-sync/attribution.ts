import type { Custody, RentalPeriod } from '../rentals';

// Why an event stays UNATTRIBUTED (REQ-ERR-06), in the order the rule is checked.
export type UnattributedReason =
  'NO_INTERVAL' | 'STATION_ORGANIZATION_DIFFERS' | 'NEAR_HANDOVER' | 'NEAR_END';

export type Attribution =
  | {
      attributed: true;
      organizationId: string;
      contractId: string;
      contractDeviceId: string;
    }
  | { attributed: false; reason: UnattributedReason };

// The detail of the ACCEPTED_UNATTRIBUTED audit row, the reason code first, so Staff can tell the
// cases apart in the sync audit (api-design 04).
export const UNATTRIBUTED_DETAIL: Record<UnattributedReason, string> = {
  NO_INTERVAL: 'NO_INTERVAL: no custody interval holds the device at the occurrence time',
  STATION_ORGANIZATION_DIFFERS:
    "STATION_ORGANIZATION_DIFFERS: the custody interval at the occurrence time is not the Field Station organization's",
  NEAR_HANDOVER:
    "NEAR_HANDOVER: the occurrence time is within the attribution margin of the interval's handover",
  NEAR_END:
    "NEAR_END: the occurrence time is within the attribution margin of the interval's check-in or loss",
};

export interface AttributionInput {
  // The custody interval `ContractsService.custodyAt` found at the occurrence time, or null.
  custody: Custody | null;
  occurredAt: Date;
  // `gatewaySync.attributionMarginSeconds`.
  marginSeconds: number;
  // The Field Station that delivered the event; null for a node uplink (Stage A and B).
  station: { organizationId: string } | null;
}

const within = (at: Date, edge: Date | null, marginMs: number) =>
  edge !== null && Math.abs(at.getTime() - edge.getTime()) <= marginMs;

// Task 2.4 (REQ-UBI-03, REQ-EVT-15, REQ-ERR-06, D-040): an event is ATTRIBUTED to the custody
// interval containing its occurrence time only when that time is clear of the margin around the
// interval's handover and end and, for a Field Station event, the interval belongs to the station's
// organization. Anything else is UNATTRIBUTED with no organization and reaches Staff and Admin only
// (BR-36). Pure: the caller reads the interval and the parameter.
export const attribute = ({
  custody,
  occurredAt,
  marginSeconds,
  station,
}: AttributionInput): Attribution => {
  if (!custody) return { attributed: false, reason: 'NO_INTERVAL' };
  if (station && station.organizationId !== custody.organizationId) {
    return { attributed: false, reason: 'STATION_ORGANIZATION_DIFFERS' };
  }
  const marginMs = marginSeconds * 1000;
  if (within(occurredAt, custody.handedOverAt, marginMs)) {
    return { attributed: false, reason: 'NEAR_HANDOVER' };
  }
  if (within(occurredAt, custody.endedAt, marginMs)) {
    return { attributed: false, reason: 'NEAR_END' };
  }
  return {
    attributed: true,
    organizationId: custody.organizationId,
    contractId: custody.contractId,
    contractDeviceId: custody.contractDeviceId,
  };
};

// REQ-EVT-05 (E02-7, AC-04, AC-08): a Field Station may deliver a device's events only while its
// organization holds the device, or for `gatewaySync.lateUploadGraceHours` after one of that
// organization's custody intervals ended, so a station can still flush what it queued before the
// check-in. `periods` are the organization's custody intervals of the device (`rentalPeriods`).
export const stationMayDeliver = (
  periods: readonly RentalPeriod[],
  receivedAt: Date,
  lateUploadGraceHours: number,
): boolean => {
  const earliestEnd = receivedAt.getTime() - lateUploadGraceHours * 3_600_000;
  return periods.some((period) =>
    period.to === null
      ? period.from.getTime() <= receivedAt.getTime()
      : period.to.getTime() > earliestEnd,
  );
};
