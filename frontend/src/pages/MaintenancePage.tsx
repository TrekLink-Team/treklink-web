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
  useMaintenanceRecords,
  weekEnd,
  type MaintenanceRecord,
  type WorkBy,
} from '../entities/device/api';
import { ApiError } from '../shared/api/apiClient';
import { formatVnd } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, Empty, ErrorState, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { Dialog } from '../shared/ui/Dialog';
import { Field, Input, RadioGroup, Select, Textarea } from '../shared/ui/Field';
import { messageOf } from '../shared/ui/errors';
import { NoAccessPage } from './NoAccessPage';
import { Tabs, TabPanel } from '../shared/ui/Tabs';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, LINK, TABLE, TD, TH } from '../shared/ui/styles';

const MSG03 = 'Saved.';

const failureOf = (error: unknown, status: string): string => {
  if (error instanceof ApiError) {
    if (error.errorCode === 'INVALID_STATE_TRANSITION') return `This cannot be done while it is ${status}.`;
    return error.message;
  }
  return messageOf(error);
};

const RECORD_TONE: Record<string, string> = {
  OPEN: 'waiting',
  PENDING_APPROVAL: 'attention',
  COMPLETED: 'done',
  UNREPAIRABLE: 'ended',
};

// Open maintenance on an AVAILABLE device (devices api-design 11), preselected when opened from the
// device detail page.
const OpenDialog: React.FC<{ deviceId: string; onDone: () => void; onCancel: () => void }> = ({
  deviceId,
  onDone,
  onCancel,
}) => {
  const { data: device } = useDevice(deviceId);
  const [description, setDescription] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [workBy, setWorkBy] = useState<WorkBy | ''>('');
  const [vendorName, setVendorName] = useState('');
  const [estimatedCostVnd, setEstimatedCostVnd] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
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
      setFailure(failureOf(failureError, device.status));
    }
  };

  if (!device) return null;

  return (
    <Dialog titleId="open-title" title={`Open maintenance for ${device.assetTag}`} onClose={onCancel} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
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
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Open maintenance
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// Estimate (devices api-design 12) on an OPEN record.
const EstimateDialog: React.FC<{ record: MaintenanceRecord; onDone: () => void; onCancel: () => void }> = ({
  record,
  onDone,
  onCancel,
}) => {
  const [workBy, setWorkBy] = useState<WorkBy>(record.workBy ?? 'IN_HOUSE');
  const [vendorName, setVendorName] = useState(record.vendorName ?? '');
  const [estimatedCostVnd, setEstimatedCostVnd] = useState(String(record.estimatedCostVnd ?? ''));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
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
        <Field id="estimate-cost" label="Estimated cost" required error={errors.estimatedCostVnd} hint="VND">
          <Input
            id="estimate-cost"
            type="number"
            min={0}
            value={estimatedCostVnd}
            onChange={(event) => setEstimatedCostVnd(event.target.value)}
          />
        </Field>
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
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

// Complete or mark unrepairable (devices api-design 14).
const CompleteDialog: React.FC<{ record: MaintenanceRecord; onDone: () => void; onCancel: () => void }> = ({
  record,
  onDone,
  onCancel,
}) => {
  const [status, setStatus] = useState<'COMPLETED' | 'UNREPAIRABLE'>('COMPLETED');
  const [resolution, setResolution] = useState('');
  const [actualCostVnd, setActualCostVnd] = useState('');
  const [warrantyUntil, setWarrantyUntil] = useState('');
  const [firmwareVersion, setFirmwareVersion] = useState('');
  const [results, setResults] = useState<Record<string, boolean | undefined>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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

    setPending(true);
    setFailure(null);
    try {
      await completeMaintenance(record.device.id, record.id, {
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
      onDone();
    } catch (failureError) {
      setPending(false);
      setFailure(failureOf(failureError, record.status));
    }
  };

  return (
    <Dialog titleId="complete-title" title={`Complete maintenance for ${record.device.assetTag}`} onClose={onCancel} size="md">
      <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
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
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-3">
          <Button type="button" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={pending}>
            Save
          </Button>
        </div>
      </form>
    </Dialog>
  );
};

// Approve or reject a cost (devices api-design 13, BR-44).
const DecideDialog: React.FC<{ record: MaintenanceRecord; onDone: () => void; onCancel: () => void }> = ({
  record,
  onDone,
  onCancel,
}) => {
  const [decision, setDecision] = useState<'APPROVED' | 'REJECTED'>('APPROVED');
  const [approvedCostVnd, setApprovedCostVnd] = useState(String(record.estimatedCostVnd ?? ''));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
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
        {failure && (
          <p role="alert" className={ALERT}>
            {failure}
          </p>
        )}
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

const RecordsTable: React.FC<{
  records: MaintenanceRecord[];
  onEstimate: (record: MaintenanceRecord) => void;
  onComplete: (record: MaintenanceRecord) => void;
}> = ({ records, onEstimate, onComplete }) => (
  <table className={TABLE}>
    <thead>
      <tr>
        <th className={TH}>Device</th>
        <th className={TH}>Reason</th>
        <th className={TH}>Status</th>
        <th className={TH}>Expected</th>
        <th className={TH}>Cost</th>
        <th className={TH}>Actions</th>
      </tr>
    </thead>
    <tbody>
      {records.map((record) => (
        <tr key={record.id}>
          <td className={TD}>
            <Link to={`/t/devices/${record.device.id}`} className={LINK}>
              {record.device.assetTag}
            </Link>
          </td>
          <td className={TD}>{record.reason}</td>
          <td className={TD}>
            <Badge tone={RECORD_TONE[record.status]}>{record.status}</Badge>
          </td>
          <td className={TD}>{record.expectedAt}</td>
          <td className={TD}>
            {record.approvedCostVnd !== null
              ? formatVnd(record.approvedCostVnd)
              : record.estimatedCostVnd !== null
                ? formatVnd(record.estimatedCostVnd)
                : 'Not estimated'}
          </td>
          <td className={TD}>
            {record.status === 'OPEN' && (
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => onEstimate(record)}>Estimate</Button>
                <Button variant="primary" onClick={() => onComplete(record)}>Complete</Button>
              </div>
            )}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
);

// /t/maintenance and /t/maintenance/approvals, MaintenancePage and MaintenanceApprovalPage of screen
// 4.3 (devices api-design 11 to 15). TrekLink Staff list, open, estimate and complete; Admin also
// decides pending costs, hidden on a record the viewer estimated (BR-44).
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
  const [opening, setOpening] = useState<string | null>(
    (location.state as { deviceId?: string } | null)?.deviceId ?? null,
  );
  const [estimating, setEstimating] = useState<MaintenanceRecord | null>(null);
  const [completing, setCompleting] = useState<MaintenanceRecord | null>(null);
  const [deciding, setDeciding] = useState<MaintenanceRecord | null>(null);

  const records = useMaintenanceRecords({});
  const week = useMaintenanceRecords({
    status: ['OPEN'],
    reason: ['SCHEDULED', 'FIRMWARE_UPDATE'],
    dueBefore: weekEnd(),
  });
  const approvals = useMaintenanceRecords({ status: ['PENDING_APPROVAL'] }, isAdmin);

  const refresh = async () => {
    showToast(MSG03);
    await queryClient.invalidateQueries({ queryKey: ['maintenance'] });
    await queryClient.invalidateQueries({ queryKey: ['devices'] });
  };

  return (
    <section aria-labelledby="maintenance-title">
      <PageTitle id="maintenance-title" title="Maintenance" />
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
          { key: 'week', label: "This week's service" },
          ...(isAdmin ? [{ key: 'approvals' as const, label: 'Approvals', count: approvals.data?.totalCount }] : []),
        ]}
        className="mb-4"
      />

      <TabPanel idPrefix="maintenance" tabKey="records" className={tab === 'records' ? undefined : 'hidden'}>
        {records.isLoading && <Loading />}
        {records.error && <ErrorState error={records.error} onRetry={() => void records.refetch()} />}
        {records.data && records.data.items.length === 0 && <Empty><p>No results match your filters.</p></Empty>}
        {records.data && records.data.items.length > 0 && (
          <RecordsTable
            records={records.data.items}
            onEstimate={setEstimating}
            onComplete={setCompleting}
          />
        )}
      </TabPanel>

      <TabPanel idPrefix="maintenance" tabKey="week" className={tab === 'week' ? undefined : 'hidden'}>
        {week.isLoading && <Loading />}
        {week.error && <ErrorState error={week.error} onRetry={() => void week.refetch()} />}
        {week.data && week.data.items.length === 0 && <Empty><p>Nothing is due this week.</p></Empty>}
        {week.data && week.data.items.length > 0 && (
          <RecordsTable records={week.data.items} onEstimate={setEstimating} onComplete={setCompleting} />
        )}
      </TabPanel>

      {isAdmin && (
        <TabPanel idPrefix="maintenance" tabKey="approvals" className={tab === 'approvals' ? undefined : 'hidden'}>
          {approvals.isLoading && <Loading />}
          {approvals.error && <ErrorState error={approvals.error} onRetry={() => void approvals.refetch()} />}
          {approvals.data && approvals.data.items.length === 0 && (
            <Empty><p>No costs are waiting for a decision.</p></Empty>
          )}
          {approvals.data && approvals.data.items.length > 0 && (
            <table className={TABLE}>
              <thead>
                <tr>
                  <th className={TH}>Device</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Estimated</th>
                  <th className={TH}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {approvals.data.items.map((record) => (
                  <tr key={record.id}>
                    <td className={TD}>
                      <Link to={`/t/devices/${record.device.id}`} className={LINK}>
                        {record.device.assetTag}
                      </Link>
                    </td>
                    <td className={TD}>{record.reason}</td>
                    <td className={TD}>
                      {record.estimatedCostVnd !== null ? formatVnd(record.estimatedCostVnd) : 'Not estimated'}
                    </td>
                    <td className={TD}>
                      {record.estimatedById === user?.id ? (
                        <span className="text-body-sm text-ink-muted">A different Admin must decide this.</span>
                      ) : (
                        <Button variant="primary" onClick={() => setDeciding(record)}>
                          Decide
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TabPanel>
      )}

      {opening && (
        <OpenDialog
          deviceId={opening}
          onDone={() => void (async () => {
            setOpening(null);
            await refresh();
          })()}
          onCancel={() => setOpening(null)}
        />
      )}
      {estimating && (
        <EstimateDialog
          record={estimating}
          onDone={() => void (async () => {
            setEstimating(null);
            await refresh();
          })()}
          onCancel={() => setEstimating(null)}
        />
      )}
      {completing && (
        <CompleteDialog
          record={completing}
          onDone={() => void (async () => {
            setCompleting(null);
            await refresh();
          })()}
          onCancel={() => setCompleting(null)}
        />
      )}
      {deciding && (
        <DecideDialog
          record={deciding}
          onDone={() => void (async () => {
            setDeciding(null);
            await refresh();
          })()}
          onCancel={() => setDeciding(null)}
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
