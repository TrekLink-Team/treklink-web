import { DeviceStatus } from '@prisma/client';

// The words a person reads for a device state in the device history (monitoring api-design 07), the
// labels the frontend shows in `shared/ui/status.ts`. RETURNED reads "Returned" here: the history row
// already names the move, so the badge's ", to inspect" would only repeat it. A `Record`, so a new state
// does not compile until it has a label.
export const DEVICE_STATUS_LABEL: Record<DeviceStatus, string> = {
  IN_INTAKE: 'In intake',
  AVAILABLE: 'Available',
  RESERVED: 'Reserved',
  RENTED: 'Rented',
  RETURNED: 'Returned',
  MAINTENANCE: 'Maintenance',
  LOST: 'Lost',
  RETIRED: 'Retired',
  DISPOSED: 'Disposed',
};

// The summary of one state row of the trail: "Registered as In intake" for the first row, otherwise
// "From Returned to Available (Inspection pass)", then the note when the move carries one.
export const stateSummary = (row: {
  fromStatus: DeviceStatus | null;
  toStatus: DeviceStatus;
  reason: string;
  note: string | null;
}): string => {
  const reason = row.reason.charAt(0) + row.reason.slice(1).toLowerCase().replace(/_/g, ' ');
  const move = row.fromStatus
    ? `From ${DEVICE_STATUS_LABEL[row.fromStatus]} to ${DEVICE_STATUS_LABEL[row.toStatus]} (${reason})`
    : `Registered as ${DEVICE_STATUS_LABEL[row.toStatus]}`;
  return row.note ? `${move}: ${row.note}` : move;
};
