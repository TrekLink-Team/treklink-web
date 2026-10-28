import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useBalance } from '../../entities/billing/api';
import {
  checkInDevices,
  closeContract,
  contractKeys,
  inspectDevice,
  resetDevice,
  type CheckInResult,
  type ContractDetail,
  type ContractDevice,
  type InspectionOutcome,
  type InspectionResult,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatVnd } from '../../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  RadioGroup,
  StatusBadge,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
  type Column,
  type StatusEntry,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import { ReplacementPanel } from './ReplacementPanel';

type Tab = 'checkin' | 'replace' | 'inspection' | 'close';

// The states that accept a check-in (REQ-STA-01): a running monthly ACTIVE contract does not.
const RETURNING = ['ENDING', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED'];

const OUTCOME: Record<InspectionResult, StatusEntry> = {
  PASSED: { label: 'Passed, available', tone: 'done' },
  DAMAGED: { label: 'Damaged, maintenance', tone: 'attention' },
  FAILED: { label: 'Failed, maintenance', tone: 'critical' },
};

interface RowState {
  reset: boolean;
  outcome?: InspectionOutcome;
}

const errorOf = (failure: unknown) =>
  failure instanceof ApiError ? failure.message : messageOf(failure);

// The reset of one returned unit (devices api-design 10): the three steps are the confirmation.
const ResetDialog: React.FC<{
  device: ContractDevice;
  onDone: () => void;
  onClose: () => void;
}> = ({ device, onDone, onClose }) => {
  const [steps, setSteps] = useState({ key: false, nodes: false, owner: false });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const all = steps.key && steps.nodes && steps.owner;

  const submit = async () => {
    setPending(true);
    try {
      await resetDevice(device.deviceId);
      onDone();
    } catch (failure) {
      setPending(false);
      setError(errorOf(failure));
    }
  };

  return (
    <Dialog
      titleId="reset-title"
      title={`Reset ${device.assetTag ?? 'device'}`}
      description="Tick each step once it is done on the unit."
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!all} loading={pending} onClick={() => void submit()}>
            Record reset
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Checkbox
          label="Channel key removed"
          checked={steps.key}
          onChange={(event) => setSteps({ ...steps, key: event.target.checked })}
        />
        <Checkbox
          label="Node database cleared"
          checked={steps.nodes}
          onChange={(event) => setSteps({ ...steps, nodes: event.target.checked })}
        />
        <Checkbox
          label="Owner name cleared"
          checked={steps.owner}
          onChange={(event) => setSteps({ ...steps, owner: event.target.checked })}
        />
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// The inspection of one reset unit (rentals api-design 16); DAMAGED needs at least one damage code.
const InspectDialog: React.FC<{
  contractId: string;
  device: ContractDevice;
  onDone: (outcome: InspectionOutcome) => void;
  onClose: () => void;
}> = ({ contractId, device, onDone, onClose }) => {
  const [result, setResult] = useState<InspectionResult | undefined>(undefined);
  const [codes, setCodes] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);

  const submit = async () => {
    if (!result) {
      setError('Choose the result.');
      return;
    }
    const damageCodes = codes
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code !== '');
    if (result === 'DAMAGED' && damageCodes.length === 0) {
      setCodesError('Enter at least one damage code.');
      return;
    }
    setPending(true);
    try {
      onDone(
        await inspectDevice(contractId, device.deviceId, {
          result,
          damageCodes: result === 'DAMAGED' ? damageCodes : [],
          note: note.trim() || undefined,
        }),
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'UNKNOWN_DAMAGE_CODE') {
        setCodesError(failure.message);
      } else setError(errorOf(failure));
    }
  };

  return (
    <Dialog
      titleId="inspect-title"
      title={`Inspect ${device.assetTag ?? 'device'}`}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Record inspection
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <RadioGroup<InspectionResult>
          name="inspection-result"
          legend="Result"
          layout="row"
          value={result}
          onChange={(value) => {
            setResult(value);
            setError(null);
          }}
          options={[
            { value: 'PASSED', label: 'Passed' },
            { value: 'DAMAGED', label: 'Damaged' },
            { value: 'FAILED', label: 'Failed' },
          ]}
        />
        {result === 'DAMAGED' && (
          <Field
            id="damage-codes"
            label="Damage codes"
            hint="Codes of the damage price list, separated by commas, for example ANTENNA_BROKEN."
            error={codesError ?? undefined}
            required
          >
            <Input
              id="damage-codes"
              value={codes}
              onChange={(event) => {
                setCodes(event.target.value);
                setCodesError(null);
              }}
            />
          </Field>
        )}
        <Field id="inspection-note" label="Note">
          <Textarea
            id="inspection-note"
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// Screen 5.5 on /t/counter/:contractId for a contract past its handover (rentals api-design 14, 16,
// 17; devices api-design 10; MF-05): check-in by scanned tags (MSG07), reset and inspection of each
// returned unit with its damage charge, and close once nothing is owed (MSG29). Replacement (4.3)
// joins with its task. Reset and inspection states shown here are those of this visit.
export const ReturnCounter: React.FC<{ contract: ContractDetail }> = ({ contract }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const balance = useBalance(contract.id, true);
  const [tab, setTab] = useState<Tab>(
    contract.status === 'RETURNED' || contract.status === 'CLOSED' ? 'close' : 'checkin',
  );
  const [scan, setScan] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [scanError, setScanError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkIn, setCheckIn] = useState<CheckInResult | null>(null);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [resetting, setResetting] = useState<ContractDevice | null>(null);
  const [inspecting, setInspecting] = useState<ContractDevice | null>(null);
  const [closing, setClosing] = useState(false);
  const [closePending, setClosePending] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);

  const canCheckIn =
    RETURNING.includes(contract.status) ||
    (contract.status === 'ACTIVE' && contract.planType === 'DAY');
  const out = contract.devices.filter(
    (device) => device.handedOverAt && !device.checkedInAt && !device.lostAt,
  );
  const back = contract.devices.filter((device) => device.checkedInAt);

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: contractKeys.detail(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.balance(contract.id) }),
      queryClient.invalidateQueries({ queryKey: contractKeys.all }),
    ]);

  const addTag = (event: React.FormEvent) => {
    event.preventDefault();
    const tag = scan.trim().toUpperCase();
    setScan('');
    if (tag === '') return;
    if (!out.some((device) => device.assetTag === tag)) {
      setScanError(`${tag} does not belong to contract ${contract.code}.`);
      return;
    }
    setScanError(null);
    setTags((current) => (current.includes(tag) ? current : [...current, tag]));
    scanRef.current?.focus();
  };

  const submitCheckIn = async () => {
    setChecking(true);
    setScanError(null);
    try {
      const result = await checkInDevices(contract.id, tags);
      setCheckIn(result);
      setTags([]);
      await refresh();
    } catch (failure) {
      setScanError(errorOf(failure));
      if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
        void refresh();
      }
    } finally {
      setChecking(false);
    }
  };

  const submitClose = async () => {
    setClosePending(true);
    setCloseError(null);
    try {
      await closeContract(contract.id, contract.version);
      setClosing(false);
      await refresh();
      showToast('Saved.');
    } catch (failure) {
      setClosePending(false);
      if (failure instanceof ApiError && failure.errorCode === 'BALANCE_OUTSTANDING') {
        setCloseError('This cannot be done while it has open balances. Settle the invoices first.');
      } else if (failure instanceof ApiError && failure.errorCode === 'OPEN_INCIDENTS') {
        setCloseError('This cannot be done while it has open incidents.');
      } else setCloseError(errorOf(failure));
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') void refresh();
    }
  };

  const columns: Column<ContractDevice, 'tag' | 'back' | 'state'>[] = [
    {
      key: 'tag',
      header: 'Asset tag',
      cell: (device) => <span className="font-mono font-semibold">{device.assetTag}</span>,
    },
    {
      key: 'back',
      header: 'Back at',
      cell: (device) => (device.checkedInAt ? formatDateTime(device.checkedInAt) : 'Out'),
    },
    {
      key: 'state',
      header: 'Inspection',
      cell: (device) => {
        const state = rows[device.deviceId];
        if (state?.outcome) {
          const charge = state.outcome.damageCharge;
          return (
            <span className="flex flex-col gap-1">
              <StatusBadge entry={OUTCOME[state.outcome.inspection.result]} />
              {charge && (
                <span className="text-body-sm text-ink-muted">
                  Damage {formatVnd(charge.amountVnd)},{' '}
                  {charge.status === 'APPROVED' ? 'on the closing invoice' : 'waiting for an Admin'}
                </span>
              )}
            </span>
          );
        }
        return state?.reset ? 'Reset logged' : 'Not reset';
      },
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Tabs<Tab>
        label="Counter steps"
        idPrefix="return"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'checkin', label: 'Check-in', count: out.length },
          ...(contract.status === 'ACTIVE' || contract.status === 'ENDING'
            ? [{ key: 'replace' as const, label: 'Replace a device' }]
            : []),
          { key: 'inspection', label: 'Reset and inspection', count: back.length },
          { key: 'close', label: 'Close' },
        ]}
      />

      {tab === 'checkin' && (
        <TabPanel idPrefix="return" tabKey="checkin">
          <Card>
            <CardHeader
              title="Check-in"
              description={`${out.length} of ${contract.devices.length} devices still out.`}
            />
            {!canCheckIn ? (
              <Alert tone={contract.status === 'ACTIVE' ? 'warning' : 'info'}>
                {contract.status === 'ACTIVE'
                  ? 'A running monthly contract cannot return devices. Give notice first.'
                  : 'No device is out on this contract.'}
              </Alert>
            ) : (
              <div className="flex flex-col gap-4">
                <form onSubmit={addTag} className="flex flex-wrap items-end gap-3">
                  <Field
                    id="scan"
                    label="Scan or type an asset tag"
                    error={scanError ?? undefined}
                    className="min-w-0 flex-1"
                  >
                    <Input
                      id="scan"
                      ref={scanRef}
                      autoFocus
                      value={scan}
                      onChange={(event) => setScan(event.target.value)}
                    />
                  </Field>
                  <Button type="submit">Add</Button>
                </form>
                <p aria-live="polite" className="text-body-sm text-ink-muted">
                  {tags.length === 0 ? 'No tag scanned yet.' : `Scanned: ${tags.join(', ')}`}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="primary"
                    disabled={tags.length === 0}
                    loading={checking}
                    onClick={() => void submitCheckIn()}
                  >
                    Check in {tags.length > 0 ? `${tags.length} devices` : ''}
                  </Button>
                  {tags.length > 0 && <Button onClick={() => setTags([])}>Clear the list</Button>}
                </div>
              </div>
            )}
            {checkIn && (
              <Alert tone="success" className="mt-4">
                Check-in complete. {checkIn.returned} of {checkIn.total} devices returned.
                {checkIn.lateFeeVnd > 0 && ` Late fee: ${formatVnd(checkIn.lateFeeVnd)}.`}
              </Alert>
            )}
          </Card>
        </TabPanel>
      )}

      {tab === 'replace' && (
        <TabPanel idPrefix="return" tabKey="replace">
          <ReplacementPanel contract={contract} onReplaced={refresh} />
        </TabPanel>
      )}

      {tab === 'inspection' && (
        <TabPanel idPrefix="return" tabKey="inspection">
          <DataTable
            caption="Returned devices"
            columns={columns}
            rows={back}
            rowId={(device) => device.deviceId}
            empty={{
              title: 'No device is back yet',
              description: 'Check devices in first; each then needs a reset and an inspection.',
            }}
            rowActions={(device) => {
              const state = rows[device.deviceId];
              if (state?.outcome) return null;
              return state?.reset ? (
                <Button size="sm" variant="primary" onClick={() => setInspecting(device)}>
                  Inspect
                </Button>
              ) : (
                <Button size="sm" onClick={() => setResetting(device)}>
                  Record reset
                </Button>
              );
            }}
          />
        </TabPanel>
      )}

      {tab === 'close' && (
        <TabPanel idPrefix="return" tabKey="close">
          <Card>
            <CardHeader title="Close the contract" />
            {balance.data && (
              <dl className="mb-4 grid gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-body-sm text-ink-muted">Due now</dt>
                  <dd className="font-semibold">{formatVnd(balance.data.dueNowVnd)}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-ink-muted">Due later</dt>
                  <dd className="font-semibold">{formatVnd(balance.data.dueLaterVnd)}</dd>
                </div>
                <div>
                  <dt className="text-body-sm text-ink-muted">Paid</dt>
                  <dd className="font-semibold">{formatVnd(balance.data.paidVnd)}</dd>
                </div>
              </dl>
            )}
            {contract.status === 'CLOSED' ? (
              <Alert tone="success">This contract is closed.</Alert>
            ) : contract.status !== 'RETURNED' ? (
              <Alert tone="info">
                A contract closes once every device is back or lost and it is RETURNED.
              </Alert>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="primary" onClick={() => setClosing(true)}>
                  Close contract
                </Button>
                <Link
                  to={`/t/billing?contractId=${contract.id}`}
                  className="text-body-sm font-semibold text-brand hover:underline"
                >
                  Open the invoices
                </Link>
              </div>
            )}
            {closeError && !closing && (
              <Alert tone="error" className="mt-4">
                {closeError}
              </Alert>
            )}
          </Card>
        </TabPanel>
      )}

      {resetting && (
        <ResetDialog
          device={resetting}
          onClose={() => setResetting(null)}
          onDone={() => {
            setRows((current) => ({ ...current, [resetting.deviceId]: { reset: true } }));
            setResetting(null);
            showToast('Saved.');
          }}
        />
      )}
      {inspecting && (
        <InspectDialog
          contractId={contract.id}
          device={inspecting}
          onClose={() => setInspecting(null)}
          onDone={(outcome) => {
            setRows((current) => ({
              ...current,
              [inspecting.deviceId]: { reset: true, outcome },
            }));
            setInspecting(null);
            void refresh();
            showToast('Saved.');
          }}
        />
      )}
      {closing && (
        <ConfirmDialog
          titleId="close-title"
          title={`Close contract ${contract.code}?`}
          description="Holder labels are erased. A closed contract cannot be reopened."
          confirmLabel="Close contract"
          pending={closePending}
          error={closeError ?? undefined}
          onConfirm={() => void submitClose()}
          onCancel={() => {
            setClosing(false);
            setCloseError(null);
          }}
        />
      )}
    </div>
  );
};
