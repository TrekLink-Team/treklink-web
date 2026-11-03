import React from 'react';
import { Link } from 'react-router-dom';
import { StatusBadge } from '../../shared/ui/Badge';
import { DEVICE_STATUS, type DeviceStatus } from '../../shared/ui/status';
import { LINK } from '../../shared/ui/styles';
import { deviceHomePath } from './paths';

interface Props {
  deviceId: string;
  // Null for a unit whose tag is not known: the id stands in.
  assetTag: string | null;
  variantName?: string;
  status?: DeviceStatus;
  // Where the link goes: see `deviceHomePath`.
  scope: 't' | 'o';
}

// A mention of one unit (specs/devices/design.md section 10, UI conventions E-2): its asset tag as a link
// to its device home, the variant name, and the status as a badge with its label, never colour alone.
export const DeviceRef: React.FC<Props> = ({ deviceId, assetTag, variantName, status, scope }) => (
  <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 whitespace-nowrap">
    <Link
      to={deviceHomePath(scope, deviceId)}
      state={{ assetTag }}
      className={`${LINK} font-mono font-medium`}
    >
      {assetTag ?? deviceId}
    </Link>
    {variantName && <span className="text-body-sm text-ink-muted">{variantName}</span>}
    {status && <StatusBadge entry={DEVICE_STATUS[status]} />}
  </span>
);
