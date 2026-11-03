import { CONTRACT_STATUS, DEVICE_STATUS, StatusBadge } from '@treklink/ui';

export const DeviceStates = () => (
  <div className="flex flex-wrap items-center gap-2">
    {Object.values(DEVICE_STATUS).map((entry) => (
      <StatusBadge key={entry.label} entry={entry} />
    ))}
  </div>
);

export const ContractStates = () => (
  <div className="flex flex-wrap items-center gap-2">
    {Object.values(CONTRACT_STATUS).map((entry) => (
      <StatusBadge key={entry.label} entry={entry} />
    ))}
  </div>
);
