import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  completeMaintenance,
  decideMaintenance,
  estimateMaintenance,
  openMaintenance,
  useDevice,
  useDevices,
  useMaintenanceRecords,
  weekEnd,
  type Device,
  type MaintenanceReason,
  type MaintenanceRecord,
  type MaintenanceStatus,
  type WorkBy,
} from '../entities/device/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { useDebounced } from '../shared/lib/useDebounced';
import { ErrorState, Fact } from '../shared/ui/bits';
import { Alert } from '../shared/ui/Alert';
import { StatusBadge } from '../shared/ui/Badge';
import { Button } from '../shared/ui/Button';
import { DataTable, Pagination, type Column, type RowAction } from '../shared/ui/DataTable';
import { lockedWhileSelecting } from '../shared/ui/lockedWhileSelecting';
import { BulkActionDialog } from '../shared/ui/BulkAction';
import type { BulkItem } from '../shared/ui/bulkSequence';
import { ConfirmDialog, Dialog } from '../shared/ui/Dialog';
import { Drawer } from '../shared/ui/Drawer';
import { PageHeader } from '../shared/ui/PageHeader';
import { Toolbar } from '../shared/ui/Toolbar';
import { DEVICE_STATUS, MAINTENANCE_REASON, MAINTENANCE_STATUS } from '../shared/ui/status';
import { Field, Input, RadioGroup, Select, Textarea } from '../shared/ui/Field';
import { messageOf } from '../shared/ui/errors';
import { NoAccessPage } from './NoAccessPage';
import { Tabs, TabPanel } from '../shared/ui/Tabs';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, LINK } from '../shared/ui/styles';

const MSG01 = 'No results match your filters.';
const MSG03 = 'Saved.';
const MSG29 = 'Finish the open maintenance record first.';
const MSG36 = 'Someone else changed this. Reload to see the latest.';

const STATUSES = Object.keys(MAINTENANCE_STATUS) as MaintenanceStatus[];
const REASONS = Object.keys(MAINTENANCE_REASON) as MaintenanceReason[];

const isStale = (error: unknown) => error instanceof ApiError && error.errorCode === 'STALE_VERSION';

const failureOf = (error: unknown, status: MaintenanceStatus | string): string => {
  if (error instanceof ApiError) {
    if (error.errorCode === 'INVALID_STATE_TRANSITION') {
      const label = MAINTENANCE_STATUS[status as MaintenanceStatus]?.label
        ?? DEVICE_STATUS[status as Device['status']]?.label
        ?? status;
      return `This cannot be done while it is ${label.toLowerCase()}.`;
    }
    if (error.errorCode === 'MAINTENANCE_OPEN') return MSG29;
    if (error.errorCode === 'STALE_VERSION') return MSG36;
    return error.message;
  }
  return messageOf(error);
};

// The failure line of a dialog. On STALE_VERSION it carries Reload (MSG36): the form keeps its
// values until the user reloads, which refetches the lists and closes the dialog.
const Failure: React.FC<{ message: string; stale: boolean; onReload: () => void }> = ({ message, stale, onReload }) => (
  <div role="alert" className={`${ALERT} flex flex-wrap items-center justify-between gap-2`}>
    <span>{message}</span>
    {stale && (
      <Button size="sm" onClick={onReload}>
        Reload
      </Button>
    )}
  </div>
);

// Open maintenance on an AVAILABLE device (devices api-design 11), preselected when opened from the
// device detail page.
const OpenDialog: React.FC<{ deviceId: string; onDone: () => void; onCancel: () => void; onReload: () => void }> = ({
  deviceId,
  onDone,
  onCancel,
  onReload,
}) => {
  const { data: device } = useDevice(deviceId);
  const [description, setDescription] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [workBy, setWorkBy] = useState<WorkBy | ''>('');
  const [vendorName, setVendorName] = useState('');
  const [estimatedCostVnd, setEstimatedCostVnd] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!device) return;
    const next: Record<string, string> = {};
    if (!description.trim()) next.description = 'Please fill in this field.';
    if (!expectedAt) next.expectedAt = 'Please fill in this field.';
    if (workBy === 'VENDOR' && !vendorName.trim()) next.vendorName = 'Name the vendor.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setFailure(null);
    try {
      await openMaintenance(deviceId, {
        reason: 'STAFF_REPORTED',
        description: description.trim(),
        expectedAt,
        ...(workBy ? { workBy } : {}),
        ...(workBy === 'VENDOR' ? { vendorName: vendorName.trim() } : {}),
        ...(estimatedCostVnd ? { estimatedCostVnd: Number(estimatedCostVnd) } : {}),
        expectedVersion: device.version,
      });
      onDone();
    } catch (failureError) {
      setPending(false);
      setStale(isStale(failureError));
      setFailure(failureOf(failureError, device.status));
    }
  };

  if (!device) return null;

  return (
    <Dialog
      titleId="open-title"
      title={`Open maintenance for ${device.assetTag}`}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="open-maintenance-form" variant="primary" loading={pending}>
            Open maintenance
          </Button>
        </>
      }
    >
      <form id="open-maintenance-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <Field id="open-description" label="Description" required error={errors.description}>
          <Textarea id="open-description" value={description} onChange={(event) => setDescription(event.target.value)} />
        </Field>
        <Field id="open-expectedAt" label="Expected completion" required error={errors.expectedAt}>
          <Input
            id="open-expectedAt"
            type="date"
            min={today}
            value={expectedAt}
            onChange={(event) => setExpectedAt(event.target.value)}
          />
        </Field>
        <Field id="open-workBy" label="Work by" hint="In house, or vendor">
          <Select id="open-workBy" value={workBy} onChange={(event) => setWorkBy(event.target.value as WorkBy | '')}>
            <option value="">Not yet decided</option>
            <option value="IN_HOUSE">In house</option>
            <option value="VENDOR">Vendor</option>
          </Select>
        </Field>
        {workBy === 'VENDOR' && (
          <Field id="open-vendorName" label="Vendor name" required error={errors.vendorName}>
            <Input id="open-vendorName" value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
          </Field>
        )}
        <Field id="open-estimate" label="Estimated cost" hint="VND">
          <Input
            id="open-estimate"
            type="number"
            min={0}
            value={estimatedCostVnd}
            onChange={(event) => setEstimatedCostVnd(event.target.value)}
          />
        </Field>
        {failure && <Failure message={failure} stale={stale} onReload={onReload} />}
      </form>
    </Dialog>
  );
};

// Estimate (devices api-design 12) on an OPEN record. The hint names the approval threshold from
// devices api-design 15 `approvalThresholdVnd`; before the list loads it names the rule only.
const EstimateDialog: React.FC<{
  record: MaintenanceRecord;
  thresholdVnd: number | undefined;
  onDone: () => void;
  onCancel: () => void;
  onReload: () => void;
}> = ({
  record,
  thresholdVnd,
  onDone,
  onCancel,
  onReload,
}) => {
  const [workBy, setWorkBy] = useState<WorkBy>(record.workBy ?? 'IN_HOUSE');
  const [vendorName, setVendorName] = useState(record.vendorName ?? '');
  const [estimatedCostVnd, setEstimatedCostVnd] = useState(String(record.estimatedCostVnd ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (workBy === 'VENDOR' && !vendorName.trim()) next.vendorName = 'Name the vendor.';
    if (estimatedCostVnd === '') next.estimatedCostVnd = 'Please fill in this field.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setFailure(null);
    try {
      await estimateMaintenance(record.device.id, record.id, {
        workBy,
        ...(workBy === 'VENDOR' ? { vendorName: vendorName.trim() } : {}),
        estimatedCostVnd: Number(estimatedCostVnd),
        expectedVersion: record.version,
      });
      onDone();
    } catch (failureError) {
      setPending(false);
      setStale(isStale(failureError));
      setFailure(failureOf(failureError, record.status));
    }
  };

  return (
    <Dialog titleId="estimate-title" title={`Estimate for ${record.device.assetTag}`} onClose={onCancel} size="sm">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <RadioGroup
          name="estimate-workBy"
          legend="Work by"
          required
          value={workBy}
          onChange={setWorkBy}
          options={[
            { value: 'IN_HOUSE', label: 'In house' },
            { value: 'VENDOR', label: 'Vendor' },
          ]}
        />
        {workBy === 'VENDOR' && (
          <Field id="estimate-vendorName" label="Vendor name" required error={errors.vendorName}>
            <Input id="estimate-vendorName" value={vendorName} onChange={(event) => setVendorName(event.target.value)} />
          </Field>
        )}
        <Field
          id="estimate-cost"
          label="Estimated cost"
          required
          error={errors.estimatedCostVnd}
          hint={
            thresholdVnd !== undefined
              ? `VND. Above ${formatVnd(thresholdVnd)}, an Admin must approve before completion.`
              : 'VND. Above the approval threshold, an Admin must approve before completion.'
          }
        >
          <Input
            id="estimate-cost"
            type="number"
            min={0}
            value={estimatedCostVnd}
            onChange={(event) => setEstimatedCostVnd(event.target.value)}
          />
        </Field>
        {failure && <Failure message={failure} stale={stale} onReload={onReload} />}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save estimate
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// Complete or mark unrepairable (devices api-design 14). Unrepairable asks first (screen 4.3).
const CompleteDialog: React.FC<{
  record: MaintenanceRecord;
  onDone: (saved: MaintenanceRecord) => void;
  onCancel: () => void;
  onReload: () => void;
}> = ({
  record,
  onDone,
  onCancel,
  onReload,
}) => {
  const [status, setStatus] = useState<'COMPLETED' | 'UNREPAIRABLE'>('COMPLETED');
  const [resolution, setResolution] = useState('');
  const [actualCostVnd, setActualCostVnd] = useState('');
  const [warrantyUntil, setWarrantyUntil] = useState('');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [results, setResults] = useState<Record<string, boolean | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!resolution.trim()) next.resolution = 'Please fill in this field.';
    if (status === 'COMPLETED' && actualCostVnd === '') next.actualCostVnd = 'Please fill in this field.';
    if (status === 'COMPLETED' && record.reason === 'FIRMWARE_UPDATE' && !firmwareVersion.trim()) {
      next.firmwareVersion = 'Please fill in this field.';
    }
    if (status === 'COMPLETED' && record.reason === 'SCHEDULED') {
      const missing = record.checklist.some((item) => results[item] === undefined);
      if (missing) next.checklist = 'Record every checklist item.';
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    if (status === 'UNREPAIRABLE') setConfirming(true);
    else void save();
  };

  const save = async () => {
    setPending(true);
    setFailure(null);
    try {
      const saved = await completeMaintenance(record.device.id, record.id, {
        status,
        resolution: resolution.trim(),
        ...(status === 'COMPLETED' ? { actualCostVnd: Number(actualCostVnd) } : {}),
        ...(status === 'COMPLETED' && warrantyUntil ? { warrantyUntil } : {}),
        ...(status === 'COMPLETED' && record.checklist.length > 0
          ? {
              checklistResults: record.checklist
                .filter((item) => results[item] !== undefined)
                .map((item) => ({ item, passed: results[item] as boolean })),
            }
          : {}),
        ...(status === 'COMPLETED' && firmwareVersion.trim() ? { firmwareVersion: firmwareVersion.trim() } : {}),
        expectedVersion: record.version,
      });
      onDone(saved);
    } catch (failureError) {
      setPending(false);
      setConfirming(false);
      setStale(isStale(failureError));
      setFailure(failureOf(failureError, record.status));
    }
  };

  if (confirming) {
    return (
      <ConfirmDialog
        titleId="unrepairable-title"
        title={`Mark ${record.device.assetTag} unrepairable?`}
        description="The device stays in maintenance until an Admin retires it."
        confirmLabel="Mark unrepairable"
        destructive
        pending={pending}
        onConfirm={() => void save()}
        onCancel={() => setConfirming(false)}
      />
    );
  }

  return (
    <Dialog
      titleId="complete-title"
      title={`Complete maintenance for ${record.device.assetTag}`}
      onClose={onCancel}
      size="md"
      footer={
        <>
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" form="complete-maintenance-form" variant="primary" loading={pending}>
            Save
          </Button>
        </>
      }
    >
      <form id="complete-maintenance-form" onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <RadioGroup
          name="complete-status"
          legend="Status"
          required
          layout="row"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'UNREPAIRABLE', label: 'Unrepairable' },
          ]}
        />
        <Field id="complete-resolution" label="Resolution" required error={errors.resolution}>
          <Textarea id="complete-resolution" value={resolution} onChange={(event) => setResolution(event.target.value)} />
        </Field>
        {status === 'COMPLETED' && (
          <>
            <Field id="complete-cost" label="Actual cost" required error={errors.actualCostVnd} hint="VND">
              <Input
                id="complete-cost"
                type="number"
                min={0}
                value={actualCostVnd}
                onChange={(event) => setActualCostVnd(event.target.value)}
              />
            </Field>
            <Field id="complete-warranty" label="Warranty until">
              <Input
                id="complete-warranty"
                type="date"
                value={warrantyUntil}
                onChange={(event) => setWarrantyUntil(event.target.value)}
              />
            </Field>
            {record.reason === 'FIRMWARE_UPDATE' && (
              <Field id="complete-firmware" label="Firmware version" required error={errors.firmwareVersion}>
                <Input
                  id="complete-firmware"
                  value={firmwareVersion}
                  onChange={(event) => setFirmwareVersion(event.target.value)}
                />
              </Field>
            )}
            {record.checklist.length > 0 && (
              <fieldset>
                <legend className="mb-1 text-body-sm font-semibold text-ink">
                  Checklist{record.reason === 'SCHEDULED' && <span aria-hidden="true"> *</span>}
                </legend>
                {record.checklist.map((item) => (
                  <RadioGroup
                    key={item}
                    name={`checklist-${item}`}
                    legend={item}
                    layout="row"
                    value={results[item] === undefined ? undefined : results[item] ? 'pass' : 'fail'}
                    onChange={(value) => setResults((prev) => ({ ...prev, [item]: value === 'pass' }))}
                    options={[
                      { value: 'pass', label: 'Pass' },
                      { value: 'fail', label: 'Fail' },
                    ]}
                  />
                ))}
                {errors.checklist && (
                  <p role="alert" className="text-body-sm font-medium text-status-critical-fg">
                    {errors.checklist}
                  </p>
                )}
              </fieldset>
            )}
          </>
        )}
        {failure && <Failure message={failure} stale={stale} onReload={onReload} />}
      </form>
    </Dialog>
  );
};

// Approve or reject a cost (devices api-design 13, BR-44).
const DecideDialog: React.FC<{ record: MaintenanceRecord; onDone: () => void; onCancel: () => void; onReload: () => void }> = ({
  record,
  onDone,
  onCancel,
  onReload,
}) => {
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [approvedCostVnd, setApprovedCostVnd] = useState(String(record.estimatedCostVnd ?? ''));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (decision === 'APPROVED' && approvedCostVnd === '') next.approvedCostVnd = 'Please fill in this field.';
    if (decision === 'REJECTED' && !reason.trim()) next.reason = 'Please fill in this field.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setPending(true);
    setFailure(null);
    try {
      await decideMaintenance(record.device.id, record.id, {
        decision,
        ...(decision === 'APPROVED' ? { approvedCostVnd: Number(approvedCostVnd) } : {}),
        ...(decision === 'REJECTED' ? { reason: reason.trim() } : {}),
        expectedVersion: record.version,
      });
      onDone();
    } catch (failureError) {
      setPending(false);
      setStale(isStale(failureError));
      if (failureError instanceof ApiError && failureError.errorCode === 'SEPARATION_OF_DUTY') {
        setFailure('A different Admin must approve this cost.');
      } else setFailure(failureOf(failureError, record.status));
    }
  };

  return (
    <Dialog titleId="decide-title" title={`Decide the cost for ${record.device.assetTag}`} onClose={onCancel} size="sm">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
        <RadioGroup
          name="decide-decision"
          legend="Decision"
          required
          layout="row"
          value={decision}
          onChange={setDecision}
          options={[
            { value: 'APPROVED', label: 'Approve' },
            { value: 'REJECTED', label: 'Reject' },
          ]}
        />
        {decision === 'APPROVED' ? (
          <Field id="decide-cost" label="Approved amount" required error={errors.approvedCostVnd} hint="VND">
            <Input
              id="decide-cost"
              type="number"
              min={0}
              value={approvedCostVnd}
              onChange={(event) => setApprovedCostVnd(event.target.value)}
            />
          </Field>
        ) : (
          <Field id="decide-reason" label="Reason" required error={errors.reason}>
            <Textarea id="decide-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
          </Field>
        )}
        {failure && <Failure message={failure} stale={stale} onReload={onReload} />}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save decision
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

const costOf = (record: MaintenanceRecord): string => {
  if (record.actualCostVnd !== null) return `${formatVnd(record.actualCostVnd)} actual`;
  if (record.approvedCostVnd !== null) return `${formatVnd(record.approvedCostVnd)} approved`;
  if (record.estimatedCostVnd !== null) return `${formatVnd(record.estimatedCostVnd)} estimated`;
  return 'Not estimated';
};

const workByOf = (record: MaintenanceRecord): string => {
  if (record.workBy === 'VENDOR') return record.vendorName ? `Vendor, ${record.vendorName}` : 'Vendor';
  if (record.workBy === 'IN_HOUSE') return 'In house';
  return 'Not decided';
};

const SELF_ESTIMATED = 'A different Admin must decide this: you recorded the estimate.';

const costsText = (count: number) => `${count} ${count === 1 ? 'cost' : 'costs'}`;

const amountToApprove = (record: MaintenanceRecord): number | null =>
  record.actualCostVnd ?? record.estimatedCostVnd;

const PICK_PAGE_SIZE = 100;
const PICK_SEARCH_DEBOUNCE_MS = 300;

// Choose the AVAILABLE device to open maintenance on, when the page was not opened from a device
// (screen 4.3: Open maintenance is shown for an AVAILABLE device with no open record).
const PickDeviceDialog: React.FC<{ onPick: (deviceId: string) => void; onCancel: () => void }> = ({
  onPick,
  onCancel,
}) => {
  const [q, setQ] = useState('');
  const settledQ = useDebounced(q.trim(), PICK_SEARCH_DEBOUNCE_MS);
  // One page of up to PICK_PAGE_SIZE AVAILABLE devices; the search narrows it by asset tag.
  const available = useDevices({ status: ['AVAILABLE'], q: settledQ || undefined, pageSize: PICK_PAGE_SIZE });
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);

  return (
    <Dialog
      titleId="pick-title"
      title="Open maintenance"
      description="Only an available device can go to maintenance from here."
      onClose={onCancel}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!deviceId) setError('Choose a device.');
              else onPick(deviceId);
            }}
          >
            Continue
          </Button>
        </>
      }
    >
      {available.error ? (
        <ErrorState error={available.error} onRetry={() => void available.refetch()} />
      ) : (
        <div className="flex flex-col gap-3">
          <Field id="pick-search" label="Search" hint="Asset tag.">
            <Input
              id="pick-search"
              value={q}
              onChange={(event) => {
                setQ(event.target.value);
                setDeviceId('');
              }}
            />
          </Field>
          <Field
            id="pick-device"
            label="Device"
            required
            error={error}
            hint={
              available.data && available.data.totalPages > 1
                ? `Showing the first ${PICK_PAGE_SIZE} of ${available.data.totalCount}; search to narrow.`
                : undefined
            }
          >
            <Select id="pick-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="">{available.isLoading ? 'Loading…' : 'Select a device'}</option>
              {(available.data?.items ?? []).map((device) => (
                <option key={device.id} value={device.id}>
                  {device.assetTag}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
    </Dialog>
  );
};

// The record detail of screen 4.3 (devices api-design 15), with Estimate and Complete on an OPEN
// record. Opening it moves focus to its heading; closing returns focus to the row.
const RecordDrawer: React.FC<{
  record: MaintenanceRecord;
  onClose: () => void;
  onEstimate: () => void;
  onComplete: () => void;
}> = ({ record, onClose, onEstimate, onComplete }) => (
  <Drawer
    titleId="record-title"
    title={`Maintenance on ${record.device.assetTag}`}
    onClose={onClose}
    footer={
      record.status === 'OPEN' ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button className="min-h-11" onClick={onEstimate}>
            Estimate
          </Button>
          <Button className="min-h-11" variant="primary" onClick={onComplete}>
            Complete
          </Button>
        </div>
      ) : undefined
    }
  >
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Fact label="Device">
        <Link to={`/t/devices/${record.device.id}`} className={LINK}>
          {record.device.assetTag}
        </Link>
      </Fact>
      <Fact label="Status">
        <StatusBadge entry={MAINTENANCE_STATUS[record.status]} />
      </Fact>
      <Fact label="Reason">{MAINTENANCE_REASON[record.reason]}</Fact>
      <Fact label="Opened">{formatDateTime(record.openedAt)}</Fact>
      <Fact label="Expected completion">{record.expectedAt}</Fact>
      <Fact label="Work by">{workByOf(record)}</Fact>
      <Fact label="Estimate">
        {record.estimatedCostVnd !== null ? formatVnd(record.estimatedCostVnd) : 'Not estimated'}
      </Fact>
      {record.decision && (
        <Fact label="Admin decision">
          {record.decision === 'APPROVED'
            ? `Approved ${record.approvedCostVnd !== null ? formatVnd(record.approvedCostVnd) : ''}`.trim()
            : `Rejected: ${record.decisionReason ?? ''}`}
        </Fact>
      )}
      {record.actualCostVnd !== null && <Fact label="Actual cost">{formatVnd(record.actualCostVnd)}</Fact>}
      {record.warrantyUntil && <Fact label="Warranty until">{record.warrantyUntil}</Fact>}
      {record.firmwareVersion && <Fact label="Firmware version">{record.firmwareVersion}</Fact>}
      {record.closedAt && <Fact label="Closed">{formatDateTime(record.closedAt)}</Fact>}
    </dl>
    <h3 className="mt-5 text-body-sm font-semibold text-ink">Description</h3>
    <p className="mt-1 whitespace-pre-line text-body text-ink">{record.description}</p>
    {record.resolution && (
      <>
        <h3 className="mt-4 text-body-sm font-semibold text-ink">Resolution</h3>
        <p className="mt-1 whitespace-pre-line text-body text-ink">{record.resolution}</p>
      </>
    )}
    {record.checklistResults && record.checklistResults.length > 0 && (
      <>
        <h3 className="mt-4 text-body-sm font-semibold text-ink">Checklist results</h3>
        <ul className="mt-1 flex flex-col gap-1 text-body text-ink">
          {record.checklistResults.map((result) => (
            <li key={result.item}>
              {result.item}: {result.passed ? 'Pass' : 'Fail'}
              {result.note ? `, ${result.note}` : ''}
            </li>
          ))}
        </ul>
      </>
    )}
  </Drawer>
);

// A pager under a records table when there is more than one page, and also when the current page is past
// the last one (the list shrank after an action), so the user can go back.
const pagerOf = (
  page: { pageNumber: number; totalPages: number; totalCount: number; pageSize: number } | undefined,
  onPage: (pageNumber: number) => void,
) =>
  page && (page.totalPages > 1 || page.pageNumber > 1) ? (
    <Pagination
      pageNumber={page.pageNumber}
      totalPages={page.totalPages}
      totalItems={page.totalCount}
      pageSize={page.pageSize}
      onPage={onPage}
    />
  ) : undefined;

const RecordsTable: React.FC<{
  caption: string;
  records: MaintenanceRecord[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  empty: string;
  onOpen: (record: MaintenanceRecord) => void;
  rowActions?: (record: MaintenanceRecord) => RowAction[];
  footer?: React.ReactNode;
  selection?: {
    ids: ReadonlySet<string>;
    onChange: (ids: Set<string>) => void;
    actions: () => React.ReactNode;
  };
}> = ({ caption, records, loading, error, onRetry, empty, onOpen, rowActions, footer, selection }) => {
  const columns: Column<MaintenanceRecord>[] = [
    {
      key: 'device',
      header: 'Device',
      cell: (record) => (
        <button type="button" className={LINK} onClick={() => onOpen(record)}>
          {record.device.assetTag}
        </button>
      ),
    },
    { key: 'reason', header: 'Reason', cell: (record) => MAINTENANCE_REASON[record.reason] },
    { key: 'status', header: 'Status', cell: (record) => <StatusBadge entry={MAINTENANCE_STATUS[record.status]} /> },
    { key: 'expected', header: 'Expected', cell: (record) => record.expectedAt },
    { key: 'workBy', header: 'Work by', hideOnMobile: true, cell: workByOf },
    { key: 'cost', header: 'Cost', align: 'end', cell: costOf },
  ];
  return (
    <DataTable
      caption={caption}
      columns={columns}
      rows={records}
      rowId={(record) => record.id}
      rowLabel={(record) => record.device.assetTag}
      noun={{ one: 'record', other: 'records' }}
      selectedIds={selection?.ids}
      onSelectionChange={selection?.onChange}
      bulkActions={selection ? () => selection.actions() : undefined}
      loading={loading}
      error={error ? <ErrorState error={error} onRetry={onRetry} /> : undefined}
      empty={{ title: empty }}
      rowActions={rowActions}
      renderCard={(record) => (
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <button type="button" className={LINK} onClick={() => onOpen(record)}>
              {record.device.assetTag}
            </button>
            <StatusBadge entry={MAINTENANCE_STATUS[record.status]} />
          </div>
          <p className="text-body-sm text-ink-muted">
            {MAINTENANCE_REASON[record.reason]}, expected {record.expectedAt}
          </p>
          {rowActions && (
            <div className="mt-1 flex flex-wrap gap-2">
              {lockedWhileSelecting(rowActions(record), (selection?.ids.size ?? 0) > 0).map((action) => (
                <Button
                  key={action.key}
                  size="sm"
                  aria-disabled={action.disabled || undefined}
                  title={action.disabled ? action.disabledReason : undefined}
                  onClick={() => {
                    if (!action.disabled) action.onSelect();
                  }}
                >
                  {action.label}
                </Button>
              ))}
              {lockedWhileSelecting(rowActions(record), (selection?.ids.size ?? 0) > 0)
                .filter((action) => action.disabled && action.disabledReason)
                .map((action) => (
                  <span key={`${action.key}-reason`} className="w-full text-body-sm text-ink-muted">
                    {action.disabledReason}
                  </span>
                ))}
            </div>
          )}
        </div>
      )}
      footer={footer}
    />
  );
};

// /t/maintenance and /t/maintenance/approvals, MaintenancePage and MaintenanceApprovalPage of screen
// 4.3 (devices api-design 06 and 11 to 15). TrekLink Staff list, open, estimate and complete; Admin
// also decides pending costs, hidden on a record the viewer estimated (BR-44).
export const MaintenancePage: React.FC = () => {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const onApprovalsRoute = location.pathname === '/t/maintenance/approvals';
  const [tab, setTab] = useState<'records' | 'week' | 'approvals'>(
    onApprovalsRoute ? 'approvals' : 'records',
  );
  const [status, setStatus] = useState<MaintenanceStatus | ''>('');
  const [reason, setReason] = useState<MaintenanceReason | ''>('');
  const [pageNumber, setPageNumber] = useState(1);
  const [weekPage, setWeekPage] = useState(1);
  const [approvalsPage, setApprovalsPage] = useState(1);
  const [picking, setPicking] = useState(false);
  const [opening, setOpening] = useState<string | null>(
    (location.state as { deviceId?: string } | null)?.deviceId ?? null,
  );
  const [viewing, setViewing] = useState<MaintenanceRecord | null>(null);
  const [estimating, setEstimating] = useState<MaintenanceRecord | null>(null);
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null);
  const [deciding, setDeciding] = useState<MaintenanceRecord | null>(null);
  const [completed, setCompleted] = useState<MaintenanceRecord | null>(null);
  // The approvals selection (W29), kept across pages.
  const [chosenApprovals, setChosenApprovals] = useState<Map<string, MaintenanceRecord>>(new Map());
  const [bulkDecision, setBulkDecision] = useState<'APPROVED' | 'REJECTED' | null>(null);
  const end = weekEnd();

  const records = useMaintenanceRecords({
    status: status ? [status] : undefined,
    reason: reason ? [reason] : undefined,
    pageNumber,
  });
  const week = useMaintenanceRecords({
    status: ['OPEN'],
    reason: ['SCHEDULED', 'FIRMWARE_UPDATE'],
    dueBefore: end,
    pageNumber: weekPage,
  });
  // Devices due for service but still out (REQ-STA-03): listed, never opened. devices api-design 06
  // has no due-date filter, so the first page of 100 reserved or rented units is narrowed here.
  const out = useDevices({ status: ['RESERVED', 'RENTED'], pageSize: 100 });
  const dueButOut = (out.data?.items ?? []).filter(
    (device) => device.serviceDueAt !== null && device.serviceDueAt <= end,
  );
  const approvals = useMaintenanceRecords({ status: ['PENDING_APPROVAL'], pageNumber: approvalsPage }, isAdmin);

  const selectApprovals = (ids: Set<string>) =>
    setChosenApprovals((current) => {
      const next = new Map<string, MaintenanceRecord>();
      ids.forEach((id) => {
        const row = current.get(id) ?? approvals.data?.items.find((item) => item.id === id);
        if (row) next.set(id, row);
      });
      return next;
    });
  // BR-44: never a record the viewer estimated. A bulk approval approves the amount the record waits
  // on, the actual cost once completed, else the estimate; a record with neither is left out.
  const rejectable = [...chosenApprovals.values()].filter((record) => record.estimatedById !== user?.id);
  const approvable = rejectable.filter((record) => amountToApprove(record) !== null);
  const approvalItems = (rows: MaintenanceRecord[]): BulkItem[] =>
    rows.map((record) => ({
      id: record.id,
      label:
        amountToApprove(record) !== null
          ? `${record.device.assetTag} (${formatVnd(amountToApprove(record) ?? 0)})`
          : record.device.assetTag,
    }));

  const invalidate = async (deviceId?: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['maintenance'] }),
      queryClient.invalidateQueries({ queryKey: ['devices'] }),
      ...(deviceId
        ? [
            queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
            queryClient.invalidateQueries({ queryKey: ['device-history', deviceId] }),
          ]
        : []),
    ]);
  };

  const saved = async (deviceId: string) => {
    showToast(MSG03);
    await invalidate(deviceId);
  };

  // STALE_VERSION: Reload refetches and closes the dialog, so the next attempt uses the new version.
  const reload = (close: () => void) => () => {
    close();
    setViewing(null);
    void invalidate();
  };

  const filtered = Boolean(status || reason);

  return (
    <section aria-labelledby="maintenance-title" className="flex flex-col gap-4">
      <PageHeader
        id="maintenance-title"
        title="Maintenance"
        primaryAction={
          <Button variant="primary" onClick={() => setPicking(true)}>
            Open maintenance
          </Button>
        }
      />
      {completed && (
        <Alert
          tone={completed.status === 'PENDING_APPROVAL' ? 'warning' : 'info'}
          onDismiss={() => setCompleted(null)}
          action={
            <Link to={`/t/devices/${completed.device.id}`} className={LINK}>
              Open {completed.device.assetTag}
            </Link>
          }
        >
          {completed.status === 'PENDING_APPROVAL'
            ? `The actual cost on ${completed.device.assetTag} needs an Admin's approval before the record closes.`
            : completed.status === 'UNREPAIRABLE'
              ? `${completed.device.assetTag} stays in maintenance until an Admin retires it.`
              : `${completed.device.assetTag} stays in maintenance until it passes an intake check on its page.`}
        </Alert>
      )}
      <Tabs
        label="Maintenance views"
        idPrefix="maintenance"
        value={tab}
        onChange={(key) => {
          setTab(key);
          navigate(key === 'approvals' ? '/t/maintenance/approvals' : '/t/maintenance');
        }}
        items={[
          { key: 'records', label: 'Records' },
          { key: 'week', label: "This week's service", count: week.data?.totalCount },
          ...(isAdmin ? [{ key: 'approvals' as const, label: 'Approvals', count: approvals.data?.totalCount }] : []),
        ]}
      />

      <TabPanel idPrefix="maintenance" tabKey="records" className={tab === 'records' ? undefined : 'hidden'}>
        <Toolbar
          label="Maintenance record filters"
          start={
            <>
              <Field id="maintenance-status" label="Status" hideLabel className="w-full sm:w-56">
                <Select
                  id="maintenance-status"
                  value={status}
                  onChange={(event) => {
                    setStatus(event.target.value as MaintenanceStatus | '');
                    setPageNumber(1);
                  }}
                >
                  <option value="">Every status</option>
                  {STATUSES.map((key) => (
                    <option key={key} value={key}>
                      {MAINTENANCE_STATUS[key].label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field id="maintenance-reason" label="Reason" hideLabel className="w-full sm:w-56">
                <Select
                  id="maintenance-reason"
                  value={reason}
                  onChange={(event) => {
                    setReason(event.target.value as MaintenanceReason | '');
                    setPageNumber(1);
                  }}
                >
                  <option value="">Every reason</option>
                  {REASONS.map((key) => (
                    <option key={key} value={key}>
                      {MAINTENANCE_REASON[key]}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          }
        />
        <RecordsTable
          caption="Maintenance records"
          records={records.data?.items}
          loading={records.isLoading}
          error={records.error}
          onRetry={() => void records.refetch()}
          empty={filtered ? MSG01 : 'No maintenance records yet.'}
          onOpen={setViewing}
          rowActions={(record) =>
            record.status === 'OPEN'
              ? [
                  { key: 'estimate', label: 'Estimate', onSelect: () => setEstimating(record) },
                  { key: 'complete', label: 'Complete', onSelect: () => setCompleting(record) },
                ]
              : []
          }
          footer={pagerOf(records.data, setPageNumber)}
        />
      </TabPanel>

      <TabPanel idPrefix="maintenance" tabKey="week" className={tab === 'week' ? 'flex flex-col gap-4' : 'hidden'}>
        <RecordsTable
          caption="This week's service"
          records={week.data?.items}
          loading={week.isLoading}
          error={week.error}
          onRetry={() => void week.refetch()}
          empty="Nothing is due this week."
          onOpen={setViewing}
          rowActions={(record) => [{ key: 'complete', label: 'Complete', onSelect: () => setCompleting(record) }]}
          footer={pagerOf(week.data, setWeekPage)}
        />
        {dueButOut.length > 0 && (
          <div>
            <h2 className="mb-2 text-title-sm text-ink">Due but still out</h2>
            <p className="mb-2 text-body-sm text-ink-muted">
              These units are due for service and on a contract. They go to maintenance after they come back.
            </p>
            <ul className="flex flex-col gap-1">
              {dueButOut.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-2 text-body">
                  <Link to={`/t/devices/${device.id}`} className={LINK}>
                    {device.assetTag}
                  </Link>
                  <StatusBadge entry={DEVICE_STATUS[device.status]} />
                  <span className="text-ink-muted">due {device.serviceDueAt}</span>
                </li>
              ))}
            </ul>
            {out.data && out.data.totalPages > 1 && (
              <p className="mt-2 text-body-sm text-ink-muted">Counted on the first 100 units out.</p>
            )}
          </div>
        )}
      </TabPanel>

      {isAdmin && (
        <TabPanel idPrefix="maintenance" tabKey="approvals" className={tab === 'approvals' ? undefined : 'hidden'}>
          <RecordsTable
            caption="Costs waiting for a decision"
            records={approvals.data?.items}
            loading={approvals.isLoading}
            error={approvals.error}
            onRetry={() => void approvals.refetch()}
            empty="No costs are waiting for a decision."
            onOpen={setViewing}
            rowActions={(record) => [
              {
                key: 'decide',
                label: 'Decide',
                disabled: record.estimatedById === user?.id,
                disabledReason: record.estimatedById === user?.id ? SELF_ESTIMATED : undefined,
                onSelect: () => setDeciding(record),
              },
            ]}
            selection={{
              ids: new Set(chosenApprovals.keys()),
              onChange: selectApprovals,
              actions: () =>
                approvable.length > 0 || rejectable.length > 0 ? (
                  <>
                    {approvable.length > 0 && (
                      <Button size="sm" variant="primary" onClick={() => setBulkDecision('APPROVED')}>
                        Approve {costsText(approvable.length)}
                      </Button>
                    )}
                    <Button size="sm" variant="danger" onClick={() => setBulkDecision('REJECTED')}>
                      Reject {costsText(rejectable.length)}
                    </Button>
                  </>
                ) : (
                  <span className="text-body-sm text-ink-muted">{SELF_ESTIMATED}</span>
                ),
            }}
            footer={pagerOf(approvals.data, setApprovalsPage)}
          />
        </TabPanel>
      )}

      {viewing && !estimating && !completing && (
        <RecordDrawer
          record={viewing}
          onClose={() => setViewing(null)}
          onEstimate={() => setEstimating(viewing)}
          onComplete={() => setCompleting(viewing)}
        />
      )}
      {picking && (
        <PickDeviceDialog
          onPick={(deviceId) => {
            setPicking(false);
            setOpening(deviceId);
          }}
          onCancel={() => setPicking(false)}
        />
      )}
      {opening && (
        <OpenDialog
          deviceId={opening}
          onDone={() => void (async () => {
            const deviceId = opening;
            setOpening(null);
            await saved(deviceId);
          })()}
          onCancel={() => setOpening(null)}
          onReload={reload(() => setOpening(null))}
        />
      )}
      {estimating && (
        <EstimateDialog
          record={estimating}
          thresholdVnd={records.data?.approvalThresholdVnd ?? week.data?.approvalThresholdVnd}
          onDone={() => void (async () => {
            const deviceId = estimating.device.id;
            setEstimating(null);
            setViewing(null);
            await saved(deviceId);
          })()}
          onCancel={() => setEstimating(null)}
          onReload={reload(() => setEstimating(null))}
        />
      )}
      {completing && (
        <CompleteDialog
          record={completing}
          onDone={(record) => void (async () => {
            setCompleting(null);
            setViewing(null);
            setCompleted(record);
            await saved(record.device.id);
          })()}
          onCancel={() => setCompleting(null)}
          onReload={reload(() => setCompleting(null))}
        />
      )}
      {bulkDecision && (
        <BulkActionDialog
          title={`${bulkDecision === 'APPROVED' ? 'Approve' : 'Reject'} ${costsText((bulkDecision === 'APPROVED' ? approvable : rejectable).length)}?`}
          confirmLabel={`${bulkDecision === 'APPROVED' ? 'Approve' : 'Reject'} ${costsText((bulkDecision === 'APPROVED' ? approvable : rejectable).length)}`}
          description={
            bulkDecision === 'APPROVED'
              ? 'Each record is approved at the amount shown and returns to OPEN, so the work can be completed.'
              : 'Each record returns to OPEN for Staff to re-estimate or close it unrepairable.'
          }
          destructive={bulkDecision === 'REJECTED'}
          needsReason={bulkDecision === 'REJECTED'}
          items={approvalItems(bulkDecision === 'APPROVED' ? approvable : rejectable)}
          run={(item, bulkReason) => {
            const record = chosenApprovals.get(item.id);
            if (!record) return Promise.reject(new Error('Record not found.'));
            return decideMaintenance(record.device.id, record.id, {
              decision: bulkDecision,
              ...(bulkDecision === 'APPROVED'
                ? { approvedCostVnd: amountToApprove(record) ?? 0 }
                : { reason: bulkReason ?? '' }),
              expectedVersion: record.version,
            });
          }}
          onFinished={() => {
            setChosenApprovals(new Map());
            void invalidate();
          }}
          onClose={() => setBulkDecision(null)}
        />
      )}
      {deciding && (
        <DecideDialog
          record={deciding}
          onDone={() => void (async () => {
            const deviceId = deciding.device.id;
            setDeciding(null);
            setViewing(null);
            await saved(deviceId);
          })()}
          onCancel={() => setDeciding(null)}
          onReload={reload(() => setDeciding(null))}
        />
      )}
    </section>
  );
};

// /t/maintenance/approvals as its own route: a Staff user gets MSG26 (screen 4.3 Roles). The same
// component serves both routes; Tabs navigates between them (D-057 rule 3), so only the active
// route's panel is shown.
export const MaintenanceApprovalPage: React.FC = () => {
  const { user } = useAuth();
  if (!hasAnyRole(user?.roles ?? [], ['ADMIN'])) return <NoAccessPage />;
  return <MaintenancePage />;
};
