import { DeviceStatus } from '@prisma/client';

// The six working states a device is reported lost from (REQ-EVT-13, design §2), and the states the
// utilization report counts as units in service (monitoring api-design 08).
export const IN_SERVICE: readonly DeviceStatus[] = [
  DeviceStatus.IN_INTAKE,
  DeviceStatus.AVAILABLE,
  DeviceStatus.RESERVED,
  DeviceStatus.RENTED,
  DeviceStatus.RETURNED,
  DeviceStatus.MAINTENANCE,
];
