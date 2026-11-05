import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useContracts } from '../entities/contract/api';
import {
  flattenGroups,
  rentedDeviceKeys,
  unassignDevice,
  useDeviceGroups,
  useRentedDevices,
  type DeviceGroup,
  type RentedDevice,
  type RentedDeviceFilters,
} from '../entities/rented-device/api';
import { ReportLossDialog } from '../features/report-loss/ReportLossDialog';
import { formatDateTime } from '../shared/lib/format';
import { useMediaQuery } from '../shared/lib/useMediaQuery';
import {
  Badge,
  Button,
  DataTable,
  Field,
  Pagination,
  Select,
  StickyPageHeader,
  type Column,
  type RowAction,
} from '../shared/ui';
import { ErrorState, PageTitle } from '../shared/ui/bits';
import { LINK } from '../shared/ui/styles';
import { useToast } from '../shared/ui/toastStore';
import {
  ContractActionDialog,
  FaultHistoryDialog,
  ReportFaultDialog,
} from '../widgets/RentedDevices/DeviceDialogs';
import {
  AssignGroupDialog,
  GroupForm,
  RemoveGroupDialog,
} from '../widgets/RentedDevices/GroupDialogs';
import { GroupTree } from '../widgets/RentedDevices/GroupTree';
import { groupTreeItemId } from '../widgets/RentedDevices/groupTreeId';

const STATES = {
  LIVE: 'Live',
  OFFLINE: 'Offline',
  NOT_HEARD: 'Not heard since handover',
} as const;
const EMPTY_GROUPS: DeviceGroup[] = [];
const DEVICE_NOUN = { one: 'device', other: 'devices' };

const columns: Column<RentedDevice>[] = [
  {
    key: 'tag',
    header: 'Asset tag',
    cell: (row) => (
      <span className="flex flex-wrap items-center gap-1">
        <span className="whitespace-nowrap">{row.assetTag}</span>
        <span className="basis-full text-xs text-ink-muted [@media(min-width:1440px)]:hidden">
          {row.variantCode}
        </span>
        {row.openFaultReportId && <Badge tone="waiting">Fault reported</Badge>}
        {row.openLossCase && <Badge tone="critical">{row.openLossCase.code}</Badge>}
      </span>
    ),
  },
  { key: 'variant', header: 'Variant', cell: (row) => row.variantCode },
  {
    key: 'contract',
    header: 'Contract',
    cell: ({ contract }) => (
      <div>
        <Link className={LINK} to={`/o/contracts/${contract.id}`}>
          {contract.code}
        </Link>
        <p className="text-xs text-ink-muted">
          {contract.planType === 'MONTHLY' ? 'Monthly' : 'Day plan'}
        </p>
      </div>
    ),
  },
  {
    key: 'state',
    header: 'State',
    cell: (row) => (
      <>
        {STATES[row.state]}
        <span className="block text-xs text-ink-muted [@media(min-width:1440px)]:hidden">
          {row.batteryPct === null ? 'Battery unknown' : `${row.batteryPct}% battery`}
        </span>
      </>
    ),
  },
  {
    key: 'battery',
    header: 'Battery',
    cell: (row) => (row.batteryPct === null ? 'Unknown' : `${row.batteryPct}%`),
  },
  {
    key: 'seen',
    header: 'Last seen',
    cell: (row) => (row.lastSeenAt ? formatDateTime(row.lastSeenAt) : 'No reading'),
  },
  { key: 'group', header: 'Group', cell: (row) => row.group?.name ?? 'No group' },
  { key: 'holder', header: 'Holder', cell: (row) => row.holder?.name ?? 'No holder label' },
];

type ConsoleDialog =
  | { kind: 'create' }
  | { kind: 'edit' | 'remove'; group: DeviceGroup }
  | { kind: 'assign'; deviceIds: string[] }
  | { kind: 'fault' | 'history' | 'loss' | 'holder' | 'notice'; device: RentedDevice };

export const RentedDevicesPage: React.FC = () => {
  const wideTable = useMediaQuery('(min-width: 1440px)', true);
  const queryClient = useQueryClient();
  const toast = useToast((state) => state.show);
  const [filters, setFilters] = useState<RentedDeviceFilters>({ pageNumber: 1 });
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<ConsoleDialog | null>(null);
  const tree = useDeviceGroups();
  const groups = tree.data?.groups ?? EMPTY_GROUPS;
  const groupIds = useMemo(
    () => new Set(flattenGroups(groups).map(({ group }) => group.id)),
    [groups],
  );
  const missingGroup =
    !!tree.data && filters.groupId && filters.groupId !== 'none' && !groupIds.has(filters.groupId);
  const activeFilters = missingGroup ? { ...filters, groupId: undefined, pageNumber: 1 } : filters;
  const devices = useRentedDevices(activeFilters);
  const contracts = useContracts('o', { pageSize: 100 });
  const contractOptions = new Map<string, string>();
  for (const row of contracts.data?.items ?? []) contractOptions.set(row.id, row.code);
  for (const { contract } of devices.data?.items ?? [])
    contractOptions.set(contract.id, contract.code);
  const filtered = !!(activeFilters.contractId || activeFilters.groupId || activeFilters.state);

  const invalidateDevices = () => {
    void queryClient.invalidateQueries({ queryKey: rentedDeviceKeys.all });
  };
  const refreshGroups = () => {
    invalidateDevices();
    void queryClient.invalidateQueries({ queryKey: rentedDeviceKeys.groups });
    void queryClient.invalidateQueries({ queryKey: ['map', 'snapshot'] });
    void queryClient.invalidateQueries({ queryKey: ['incidents'] });
  };
  const unassign = useMutation({
    mutationFn: ({ deviceId, group }: RentedDevice) => {
      if (!group) throw new Error('This device is already ungrouped.');
      return unassignDevice(group.id, deviceId);
    },
    onSuccess: () => {
      refreshGroups();
      toast('Saved.');
    },
  });
  const change = (next: Partial<RentedDeviceFilters>) => {
    setFilters({ ...activeFilters, ...next, pageNumber: 1 });
    setSelected(new Set());
  };
  const clear = () => {
    setFilters({ pageNumber: 1 });
    setSelected(new Set());
  };
  const close = () => setDialog(null);
  const actions = (row: RentedDevice): RowAction[] => [
    {
      key: 'history',
      label: 'Fault history',
      onSelect: () => setDialog({ kind: 'history', device: row }),
    },
    {
      key: 'unassign',
      label: 'Remove from group',
      disabled: !row.group || unassign.isPending,
      disabledReason: !row.group
        ? 'This device is not assigned to a group.'
        : unassign.isPending
          ? 'A group change is being saved.'
          : undefined,
      onSelect: () => unassign.mutate(row),
    },
    {
      key: 'fault',
      label: 'Report fault',
      disabled: !!row.openFaultReportId || !!row.openLossCase,
      disabledReason: row.openFaultReportId
        ? 'A fault is already reported for this device.'
        : row.openLossCase
          ? 'This device has an open loss case.'
          : undefined,
      onSelect: () => setDialog({ kind: 'fault', device: row }),
    },
    {
      key: 'holder',
      label: 'Label holder',
      disabled: row.contract.status === 'CLOSED',
      disabledReason: row.contract.status === 'CLOSED' ? 'This contract is closed.' : undefined,
      onSelect: () => setDialog({ kind: 'holder', device: row }),
    },
    {
      key: 'loss',
      label: 'Report lost',
      disabled: row.contract.status === 'CLOSED' || !!row.openLossCase,
      disabledReason:
        row.contract.status === 'CLOSED'
          ? 'This contract is closed.'
          : row.openLossCase
            ? 'This device already has an open loss case.'
            : undefined,
      destructive: true,
      onSelect: () => setDialog({ kind: 'loss', device: row }),
    },
    {
      key: 'notice',
      label: 'Give notice',
      disabled: row.contract.status !== 'ACTIVE' || row.contract.planType !== 'MONTHLY',
      disabledReason:
        row.contract.planType !== 'MONTHLY'
          ? 'Notice is only available for a monthly contract.'
          : row.contract.status !== 'ACTIVE'
            ? 'Notice is only available while the contract is Active.'
            : undefined,
      onSelect: () => setDialog({ kind: 'notice', device: row }),
    },
  ];
  return (
    <section
      data-fit-page=""
      aria-labelledby="rented-devices-title"
      className="relative flex h-0 min-h-0 flex-1 flex-col [@media(max-height:479.98px)]:h-auto [@media(max-height:479.98px)]:flex-none"
    >
      <StickyPageHeader className="shrink-0">
        <PageTitle id="rented-devices-title" title="Rented devices" />
      </StickyPageHeader>
      <div className="grid min-h-0 flex-1 grid-rows-[auto_minmax(0,1fr)] gap-2 md:grid-cols-[17.5rem_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] md:gap-4 [@media(max-height:479.98px)]:flex-none">
        {tree.error ? (
          <ErrorState error={tree.error} onRetry={() => void tree.refetch()} />
        ) : (
          <GroupTree
            groups={groups}
            loading={tree.isPending}
            selected={activeFilters.groupId ?? ''}
            onSelect={(groupId) => change({ groupId: groupId || undefined })}
            onCreate={() => setDialog({ kind: 'create' })}
            onEdit={(group) => setDialog({ kind: 'edit', group })}
            onRemove={(group) => setDialog({ kind: 'remove', group })}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="grid shrink-0 grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end">
            <Field id="rented-device-contract" label="Contract" className="min-w-0">
              <Select
                id="rented-device-contract"
                value={activeFilters.contractId ?? ''}
                onChange={(event) => change({ contractId: event.target.value || undefined })}
              >
                <option value="">All contracts</option>
                {[...contractOptions].map(([id, code]) => (
                  <option key={id} value={id}>
                    {code}
                  </option>
                ))}
              </Select>
            </Field>
            <Field id="rented-device-state" label="State" className="min-w-0">
              <Select
                id="rented-device-state"
                value={activeFilters.state ?? ''}
                onChange={(event) =>
                  change({
                    state: (event.target.value || undefined) as RentedDeviceFilters['state'],
                  })
                }
              >
                <option value="">All states</option>
                {Object.entries(STATES).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            {filtered && (
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
          </div>
          <p role="status" className="sr-only">
            {devices.data
              ? `${devices.data.totalCount} ${devices.data.totalCount === 1 ? 'device' : 'devices'} shown`
              : ''}
          </p>
          {unassign.error && <ErrorState error={unassign.error} />}
          <DataTable<RentedDevice>
            className="relative flex min-h-0 flex-1 flex-col [&>div.overflow-auto]:min-h-0 [&>div.overflow-auto]:flex-1 [@media(max-height:479.98px)]:flex-none"
            caption="Rented devices"
            columns={
              wideTable
                ? columns
                : columns.filter(({ key }) => key !== 'variant' && key !== 'battery')
            }
            rows={devices.data?.items}
            loading={devices.isPending}
            error={
              devices.error ? (
                <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />
              ) : undefined
            }
            empty={
              filtered
                ? { title: 'No devices match your filters.' }
                : { title: 'Your organization holds no devices right now.' }
            }
            noun={DEVICE_NOUN}
            rowId={(row) => row.deviceId}
            rowLabel={(row) => row.assetTag}
            rowActions={actions}
            onRowActivate={(device) => setDialog({ kind: 'history', device })}
            selectedIds={selected}
            onSelectionChange={setSelected}
            bulkActions={({ ids }) => (
              <>
                <Button
                  disabled={!groups.length || ids.size > 100}
                  onClick={() => setDialog({ kind: 'assign', deviceIds: [...ids] })}
                >
                  Assign to group
                </Button>
                {!groups.length && <span className="text-sm">Create a group first.</span>}
                {ids.size > 100 && (
                  <span className="text-sm">Select at most 100 devices per assignment.</span>
                )}
              </>
            )}
            footer={
              devices.data && devices.data.totalPages > 1 ? (
                <Pagination
                  pageNumber={devices.data.pageNumber}
                  totalPages={devices.data.totalPages}
                  totalItems={devices.data.totalCount}
                  pageSize={devices.data.pageSize}
                  onPage={(pageNumber) => setFilters({ ...activeFilters, pageNumber })}
                />
              ) : undefined
            }
          />
        </div>
      </div>
      {(dialog?.kind === 'create' || dialog?.kind === 'edit') && (
        <GroupForm
          groups={groups}
          maxDepth={tree.data?.maxDepth ?? 1}
          group={dialog.kind === 'edit' ? dialog.group : undefined}
          onClose={close}
          onReload={() => {
            refreshGroups();
            close();
          }}
          onSaved={() => {
            refreshGroups();
            toast('Saved.');
            close();
          }}
        />
      )}
      {dialog?.kind === 'remove' && (
        <RemoveGroupDialog
          group={dialog.group}
          onClose={close}
          onRemoved={() => {
            const { group } = dialog;
            if (flattenGroups([group]).some((item) => item.group.id === activeFilters.groupId))
              change({ groupId: group.parentId ?? undefined });
            refreshGroups();
            toast('Saved.');
            close();
            requestAnimationFrame(() => {
              const parent = group.parentId
                ? document.getElementById(groupTreeItemId(group.parentId))
                : null;
              if (parent?.getClientRects().length) parent.focus();
              else document.getElementById('new-rented-group')?.focus();
            });
          }}
        />
      )}
      {dialog?.kind === 'assign' && (
        <AssignGroupDialog
          groups={groups}
          deviceIds={dialog.deviceIds}
          onClose={close}
          onDeviceNotHeld={invalidateDevices}
          onAssigned={(message) => {
            refreshGroups();
            setSelected(new Set());
            toast(message);
            close();
          }}
        />
      )}
      {dialog?.kind === 'history' && <FaultHistoryDialog device={dialog.device} onClose={close} />}
      {dialog?.kind === 'fault' && (
        <ReportFaultDialog
          device={dialog.device}
          onClose={close}
          onReported={() => {
            invalidateDevices();
            void queryClient.invalidateQueries({
              queryKey: rentedDeviceKeys.faults(dialog.device.contract.id),
            });
            toast('Fault reported. TrekLink Staff have been notified.');
            close();
          }}
        />
      )}
      {dialog?.kind === 'loss' && (
        <ReportLossDialog
          deviceId={dialog.device.deviceId}
          assetTag={dialog.device.assetTag}
          scope="o"
          onClose={close}
          onReported={invalidateDevices}
        />
      )}
      {(dialog?.kind === 'holder' || dialog?.kind === 'notice') && (
        <ContractActionDialog
          device={dialog.device}
          action={dialog.kind}
          onClose={() => {
            invalidateDevices();
            close();
          }}
        />
      )}
    </section>
  );
};
