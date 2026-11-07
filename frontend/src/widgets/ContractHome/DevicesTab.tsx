import React from 'react';
import { Link } from 'react-router-dom';
import { Cpu, Flag, HandCoins, Tag, Undo2 } from 'lucide-react';
import type { ContractDetail, ContractDevice } from '../../entities/contract/api';
import { NEXT_STEP_LABELS, nextStepPath } from '../../entities/device/api';
import { DeviceRef } from '../../entities/device/DeviceRef';
import { VariantCard } from '../../entities/variant/VariantCard';
import { VariantSubtitle, VariantTile } from '../../entities/variant/VariantTile';
import { formatDateTime } from '../../shared/lib/format';
import { StatusBadge } from '../../shared/ui/Badge';
import {
  CollectionView,
  type CollectionAction,
  type CollectionField,
} from '../../shared/ui/collection-view';
import { DEVICE_STATUS } from '../../shared/ui/status';
import { LINK } from '../../shared/ui/styles';
import type { Viewer } from './policy';

const tagOf = (device: ContractDevice) => device.assetTag ?? device.deviceId;
const isOut = (device: ContractDevice) =>
  Boolean(device.handedOverAt && !device.checkedInAt && !device.lostAt);
const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso) : 'Not yet');

interface Props {
  contract: ContractDetail;
  scope: 'o' | 't';
  viewer: Viewer;
  /** Holder labels belong to the renting organization's members (rentals api-design 13). */
  canLabel: boolean;
  onLabel: (device: ContractDevice) => void;
  onReportLost: (device: ContractDevice) => void;
  onRequestCredit: (device: ContractDevice) => void;
  onRelease: (device: ContractDevice) => void;
}

/**
 * The Devices tab of the contract home on CollectionView (chapter 06 §9): every unit as a DeviceRef,
 * the contract's variant as a VariantCard, the holder, handover and return, and for TrekLink the
 * unit's state after the return with its next step (D-092 rule 4). Label, Report lost and Request
 * service credit are item actions named after the unit (screen 5.2, W29).
 */
export const DevicesTab: React.FC<Props> = ({
  contract,
  scope,
  viewer,
  canLabel,
  onLabel,
  onReportLost,
  onRequestCredit,
  onRelease,
}) => {
  const variant = contract.devices.find((device) => device.hardwareVariant)?.hardwareVariant;
  const showState = scope === 't' && contract.devices.some((device) => device.afterReturn);
  const showKey = scope === 't' && contract.status === 'APPROVED';
  const closed = contract.status === 'CLOSED';
  const canReport = viewer === 'manager' && !closed;
  const canCredit = viewer === 'staff';
  const creditable = (device: ContractDevice) =>
    canCredit &&
    Boolean(device.checkedInAt && device.contractDeviceId) &&
    device.inspection?.result === 'FAILED';
  // Release a unit (screen 5.2, D-099): Staff, on a unit out on a running contract or held before the
  // handover; on the last such unit it stays visible, disabled, with where to go instead.
  const running = contract.status === 'ACTIVE' || contract.status === 'ENDING';
  const beforeHandover = contract.status === 'REQUESTED' || contract.status === 'APPROVED';
  const releasable = (device: ContractDevice) =>
    viewer === 'staff' && ((running && isOut(device)) || (beforeHandover && !device.handedOverAt));
  const liveUnits = contract.devices.filter(releasable).length;

  const fields: CollectionField<ContractDevice>[] = [
    {
      key: 'holder',
      label: 'Holder',
      render: (device) => device.holder?.name ?? 'No label',
      text: (device) => device.holder?.name ?? 'No label',
      sortable: true,
      compact: true,
    },
    {
      key: 'out',
      label: 'Handed over',
      render: (device) => when(device.handedOverAt),
      text: (device) => device.handedOverAt ?? '',
      sortable: true,
      hideWithPane: true,
    },
    {
      key: 'back',
      label: 'Back',
      render: (device) => (device.lostAt ? 'Lost' : when(device.checkedInAt)),
      text: (device) => (device.lostAt ? 'Lost' : (device.checkedInAt ?? '')),
      compact: true,
    },
    ...(showKey
      ? [
          {
            key: 'key',
            label: 'Channel key',
            render: (device: ContractDevice) =>
              device.provisionedKeyVersion
                ? `Provisioned v${device.provisionedKeyVersion}`
                : 'Not provisioned yet',
            text: (device: ContractDevice) =>
              device.provisionedKeyVersion ? 'Provisioned' : 'Not provisioned yet',
            compact: true,
          },
        ]
      : []),
    ...(showState
      ? [
          {
            key: 'state',
            label: 'State now',
            render: (device: ContractDevice) => {
              const after = device.afterReturn;
              if (!after) return null;
              const step = after.nextStep;
              const path = step ? nextStepPath(step, device.deviceId) : null;
              return (
                <span className="flex flex-col items-start gap-1">
                  <StatusBadge entry={DEVICE_STATUS[after.status]} />
                  {step &&
                    (path ? (
                      <Link
                        to={path}
                        className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}
                      >
                        Next: {NEXT_STEP_LABELS[step.action]}
                      </Link>
                    ) : (
                      <span className="text-body-sm text-ink-muted">
                        Next: {NEXT_STEP_LABELS[step.action]}
                      </span>
                    ))}
                </span>
              );
            },
            text: (device: ContractDevice) =>
              device.afterReturn ? DEVICE_STATUS[device.afterReturn.status].label : '',
            compact: true,
          },
        ]
      : []),
  ];

  const actions: CollectionAction<ContractDevice>[] = [
    {
      key: 'label',
      label: 'Label',
      icon: <Tag />,
      allowed: (device) => canLabel && isOut(device),
      onSelect: onLabel,
    },
    {
      key: 'credit',
      label: 'Request service credit',
      icon: <HandCoins />,
      allowed: creditable,
      onSelect: onRequestCredit,
    },
    ...(viewer === 'staff' && (running || beforeHandover)
      ? [
          {
            key: 'release',
            label: 'Release',
            icon: <Undo2 />,
            destructive: true,
            allowed: (device: ContractDevice) => releasable(device) && liveUnits > 1,
            unavailableReason: (device: ContractDevice) =>
              releasable(device) && liveUnits <= 1
                ? running
                  ? 'This is the last unit. End the contract now instead.'
                  : 'This is the last unit. Cancel the request instead.'
                : undefined,
            onSelect: onRelease,
          },
        ]
      : []),
    {
      key: 'report',
      label: 'Report lost',
      icon: <Flag />,
      destructive: true,
      allowed: (device) => canReport && isOut(device),
      onSelect: onReportLost,
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {variant && (
        <div className="rounded-panel border border-line bg-surface p-3 shadow-raise">
          {/* The icon render above the list, the detail render in the details pane (design section 10). */}
          <VariantCard variant={variant} render="icon" headingLevel="h2">
            <p className="mt-1 text-body-sm text-ink-muted">
              {contract.quantity} {contract.quantity === 1 ? 'unit' : 'units'} of this variant on{' '}
              {contract.code}
            </p>
          </VariantCard>
        </div>
      )}
      <CollectionView<ContractDevice>
        label={`Devices of ${contract.code}`}
        items={contract.devices}
        itemId={(device) => device.deviceId}
        itemName={tagOf}
        itemTitle={(device) => (
          <span className="inline-flex flex-wrap items-center gap-x-3">
            {/* A DeviceRef (devices design section 10): the device home for TrekLink, the position
                history for an organization, which has no device home. */}
            <DeviceRef
              deviceId={device.deviceId}
              assetTag={device.assetTag}
              scope={scope}
              linked={scope === 't' || device.handedOverAt !== null}
            />
            {device.handedOverAt && scope === 't' && (
              <Link
                to={`/t/devices/${device.deviceId}/telemetry`}
                state={{ assetTag: device.assetTag }}
                className={`${LINK} inline-flex min-h-6 items-center text-body-sm`}
              >
                History
              </Link>
            )}
          </span>
        )}
        fields={fields}
        noun={{ one: 'unit', other: 'units' }}
        cardImage={variant ? () => <VariantTile variant={variant} /> : undefined}
        cardSubtitle={variant ? () => <VariantSubtitle variant={variant} /> : undefined}
        icon={<Cpu />}
        itemActions={actions}
        search={{ label: 'Search by asset tag or holder' }}
        filters={[
          { key: 'all', label: 'All units' },
          { key: 'out', label: 'Out now', test: isOut },
          { key: 'back', label: 'Checked in', test: (device) => Boolean(device.checkedInAt) },
          { key: 'lost', label: 'Lost', test: (device) => Boolean(device.lostAt) },
        ]}
        details={{
          image: variant
            ? () => <VariantCard variant={variant} render="detail" headingLevel="h3" />
            : undefined,
          extra: (device) =>
            device.holder?.phone || device.holder?.emergencyContact ? (
              <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-body-sm">
                {device.holder.phone && (
                  <>
                    <dt className="text-ink-muted">Holder phone</dt>
                    <dd className="text-ink">{device.holder.phone}</dd>
                  </>
                )}
                {device.holder.emergencyContact && (
                  <>
                    <dt className="text-ink-muted">Emergency contact</dt>
                    <dd className="text-ink">{device.holder.emergencyContact}</dd>
                  </>
                )}
              </dl>
            ) : null,
          href: (device) =>
            scope === 't'
              ? `/t/devices/${device.deviceId}`
              : device.handedOverAt
                ? `/o/devices/${device.deviceId}/telemetry`
                : undefined,
          hrefLabel: scope === 't' ? 'Open the device page' : 'Open the position history',
        }}
        emptyState={{
          title: 'No devices yet.',
          description:
            contract.status === 'REQUESTED' || contract.status === 'APPROVED'
              ? 'The held units appear here once the server lists them.'
              : 'This contract has no units.',
        }}
      />
    </div>
  );
};
