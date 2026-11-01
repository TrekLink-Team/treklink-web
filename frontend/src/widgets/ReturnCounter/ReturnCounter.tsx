import React, { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { damageCodesFor, useBalance, useDamageRates } from '../../entities/billing/api';
import {
  checkInDevices,
  contractKeys,
  inspectDevice,
  resetDevice,
  useCloseCheck,
  type CheckInResult,
  type CloseBlocker,
  type ContractDetail,
  type ContractDevice,
  type InspectionOutcome,
  type InspectionResult,
} from '../../entities/contract/api';
import { NEXT_STEP_LABELS, nextStepPath } from '../../entities/device/api';
import { CloseBlockers } from '../../features/close-contract/CloseBlockers';
import { CloseContractDialog } from '../../features/close-contract/CloseContractDialog';
import { ReportLossDialog } from '../../features/report-loss/ReportLossDialog';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatVnd } from '../../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  DEVICE_STATUS,
  Dialog,
  Field,
  Input,
  PageActionBar,
  RadioGroup,
  Skeleton,
  StatusBadge,
  StickyPageHeader,
  TabPanel,
  Tabs,
  Textarea,
  useToast,
  type Column,
  type StatusEntry,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';
import { LINK } from '../../shared/ui/styles';
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
  onDone: (alreadyReset: boolean) => void;
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
      onDone(false);
    } catch (failure) {
      // Another counter already logged this return's reset: the unit is reset, so carry on and say
      // that this counter recorded nothing.
      if (failure instanceof ApiError && failure.errorCode === 'ALREADY_RESET') {
        onDone(true);
        return;
      }
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

// The inspection of one reset unit (rentals api-design 16); DAMAGED needs at least one damage code,
// chosen from the damage price list of the contract's variant (billing api-design 05).
const InspectDialog: React.FC<{
  contractId: string;
  hardwareVariantId: string;
  device: ContractDevice;
  onDone: (outcome: InspectionOutcome) => void;
  onClose: () => void;
}> = ({ contractId, hardwareVariantId, device, onDone, onClose }) => {
  const [result, setResult] = useState<InspectionResult | undefined>(undefined);
  const [codes, setCodes] = useState<string[]>([]);
  const rates = useDamageRates(hardwareVariantId);
  const choices = damageCodesFor(rates.data ?? [], hardwareVariantId);
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [codesError, setCodesError] = useState<string | null>(null);

  const submit = async () => {
    if (!result) {
      setError('Choose the result.');
      return;
    }
    // Only the codes still offered: one deactivated since the list loaded has no checkbox left to
    // untick after the reload, so it would be sent again (review of #129).
    const damageCodes = codes.filter((code) => choices.some((rate) => rate.code === code));
    if (result === 'DAMAGED' && damageCodes.length === 0) {
      setCodesError('Choose at least one damage code.');
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
        // A code deactivated since the list loaded: the server's message, and the list reloads.
        setCodesError(failure.message);
        void rates.refetch();
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
        {result === 'DAMAGED' &&
          (rates.isLoading ? (
            <Skeleton className="h-24" />
          ) : rates.error ? (
            <Alert
              tone="error"
              action={
                <Button size="sm" onClick={() => void rates.refetch()}>
                  Try again
                </Button>
              }
            >
              {messageOf(rates.error)}
            </Alert>
          ) : choices.length === 0 ? (
            <Alert tone="warning">
              No damage code is priced for this variant. An Admin adds one on the Prices page.
            </Alert>
          ) : (
            <fieldset
              aria-describedby={codesError ? 'damage-codes-error' : undefined}
              className="flex flex-col gap-1"
            >
              <legend className="mb-1 text-body-sm font-semibold text-ink">
                Damage codes
                <span aria-hidden="true" className="ml-0.5 text-status-critical-fg">
                  *
                </span>
                <span className="sr-only"> (required)</span>
              </legend>
              {choices.map((rate) => (
                <Checkbox
                  key={rate.code}
                  id={`damage-${rate.code}`}
                  label={`${rate.label} (${rate.code})`}
                  description={formatVnd(rate.amountVnd)}
                  checked={codes.includes(rate.code)}
                  onChange={(event) => {
                    const { checked } = event.target;
                    setCodes((current) =>
                      checked
                        ? [...current, rate.code]
                        : current.filter((code) => code !== rate.code),
                    );
                    setCodesError(null);
                  }}
                />
              ))}
              {codesError && (
                <p
                  id="damage-codes-error"
                  role="alert"
                  className="text-body-sm font-medium text-status-critical-fg"
                >
                  {codesError}
                </p>
              )}
            </fieldset>
          ))}
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
// 17, 20; devices api-design 10 and 17; MF-05): check-in by scanned tags (MSG07), Report lost for a
// unit that did not come back (a return never needs a replacement, D-092 rule 3), reset and
// inspection of each returned unit with its damage charge and its next step back to AVAILABLE
// (D-092 rule 4), and close whenever the close check passes, with every blocker listed otherwise.
// The reset and inspection of each unit come from the contract read (resetAt, inspection), so a
// reload keeps them; the damage charge of an inspection shows on this visit only.
/**
 * Screen 5.5. `header` is the page's title block; it sticks with the step tabs at the top, and the
 * current step's primary action sits in the page action bar (leader rule of 2026-10-30).
 */
export const ReturnCounter: React.FC<{ contract: ContractDetail; header?: React.ReactNode }> = ({
  contract,
  header,
}) => {
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
  const [reporting, setReporting] = useState<{ deviceId: string; assetTag: string } | null>(
    null,
  );
  const scanRef = useRef<HTMLInputElement>(null);
  // The close check (api-design 20) decides the Close action, not the cached contract status: it is
  // refetched on window focus and after every action here, so a loss settled or an invoice paid in
  // another window shows the action (the missing close button of the 2026-11-01 demo).
  const closeCheck = useCloseCheck(contract.id, contract.status !== 'CLOSED');

  const canCheckIn =
    RETURNING.includes(contract.status) ||
    (contract.status === 'ACTIVE' && contract.planType === 'DAY');
  const out = contract.devices.filter(
    (device) => device.handedOverAt && !device.checkedInAt && !device.lostAt,
  );
  const back = contract.devices.filter((device) => device.checkedInAt);
  const isReset = (device: ContractDevice) =>
    Boolean(rows[device.deviceId]?.reset || device.resetAt);
  const isInspected = (device: ContractDevice) =>
    Boolean(rows[device.deviceId]?.outcome || device.inspection);
  const lossCaseOf = (deviceId: string) =>
    closeCheck.data?.blockers.find(
      (blocker): blocker is Extract<CloseBlocker, { code: 'DEVICE_OUT' }> =>
        blocker.code === 'DEVICE_OUT' && blocker.deviceId === deviceId,
    )?.lossCase ?? null;
  const canClose = closeCheck.data?.canClose === true;

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

  const columns: Column<ContractDevice, 'tag' | 'back' | 'state' | 'next'>[] = [
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
        if (device.inspection) return <StatusBadge entry={OUTCOME[device.inspection.result]} />;
        if (!isReset(device)) return 'Not reset';
        return device.resetAt ? `Reset logged ${formatDateTime(device.resetAt)}` : 'Reset logged';
      },
    },
    {
      // The unit's state now and its next step back to AVAILABLE (rentals api-design 03 afterReturn,
      // D-092 rule 4): the reset and the inspection are this tab's row actions; maintenance and the
      // intake check are recorded elsewhere, so the row links there.
      key: 'next',
      header: 'State now',
      cell: (device) => {
        const after = device.afterReturn;
        if (!after) return null;
        const step = after.nextStep;
        const path = step && step.action !== 'RESET' && step.action !== 'INSPECT'
          ? nextStepPath(step, device.deviceId)
          : null;
        return (
          <span className="flex flex-col gap-1">
            <StatusBadge entry={DEVICE_STATUS[after.status]} />
            {step && (
              <span className="text-body-sm text-ink-muted">
                Next: {NEXT_STEP_LABELS[step.action]}
                {path && (
                  <>
                    {' '}
                    <Link to={path} className={LINK}>
                      {step.action === 'COMPLETE_MAINTENANCE'
                        ? 'Open maintenance'
                        : `Open ${device.assetTag ?? 'the device'}`}
                    </Link>
                  </>
                )}
              </span>
            )}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-5">
      <StickyPageHeader>
        {header}
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
      </StickyPageHeader>

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
              </div>
            )}
            {out.length > 0 && (
              <div className="mt-4 flex flex-col gap-2">
                <h3 className="text-body-sm font-semibold text-ink">Still out</h3>
                <p className="text-body-sm text-ink-muted">
                  A unit that did not come back needs no replacement: report it lost. The contract
                  closes once each lost unit is settled and the balance is paid.
                </p>
                <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
                  {out.map((device) => {
                    const lossCase = lossCaseOf(device.deviceId);
                    const tag = device.assetTag ?? device.deviceId;
                    return (
                      <li
                        key={device.deviceId}
                        className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="font-mono font-semibold">{tag}</span>
                        {lossCase ? (
                          <Link to={`/t/loss-cases/${lossCase.id}`} className={`${LINK} text-body-sm`}>
                            Loss case {lossCase.code} open
                          </Link>
                        ) : (
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setReporting({ deviceId: device.deviceId, assetTag: tag })}
                          >
                            Report lost
                          </Button>
                        )}
                      </li>
                    );
                  })}
                </ul>
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
              if (isInspected(device)) return null;
              return isReset(device) ? (
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
            ) : closeCheck.isLoading ? (
              <Skeleton className="h-16" />
            ) : closeCheck.error ? (
              <Alert
                tone="error"
                action={
                  <Button size="sm" onClick={() => void closeCheck.refetch()}>
                    Try again
                  </Button>
                }
              >
                {messageOf(closeCheck.error)}
              </Alert>
            ) : canClose ? (
              <Alert tone="success">Nothing blocks the close. Close the contract below.</Alert>
            ) : (
              closeCheck.data && (
                <CloseBlockers
                  check={closeCheck.data}
                  onReportLost={(blocker) =>
                    setReporting({ deviceId: blocker.deviceId, assetTag: blocker.assetTag })
                  }
                />
              )
            )}
          </Card>
        </TabPanel>
      )}

      {tab === 'checkin' && canCheckIn && (
        <PageActionBar
          label="Check-in actions"
          start={tags.length > 0 && <Button onClick={() => setTags([])}>Clear the list</Button>}
        >
          <Button
            variant="primary"
            disabled={tags.length === 0}
            loading={checking}
            onClick={() => void submitCheckIn()}
          >
            Check in {tags.length > 0 ? `${tags.length} devices` : ''}
          </Button>
        </PageActionBar>
      )}
      {tab === 'close' && canClose && (
        <PageActionBar label="Close actions">
          <Button variant="primary" onClick={() => setClosing(true)}>
            Close contract
          </Button>
        </PageActionBar>
      )}

      {resetting && (
        <ResetDialog
          device={resetting}
          onClose={() => setResetting(null)}
          onDone={(alreadyReset) => {
            setRows((current) => ({ ...current, [resetting.deviceId]: { reset: true } }));
            setResetting(null);
            // The refresh brings the reset time someone else recorded into the row.
            void refresh();
            showToast(alreadyReset ? 'Already reset. It was recorded by someone else.' : 'Saved.');
          }}
        />
      )}
      {inspecting && (
        <InspectDialog
          contractId={contract.id}
          hardwareVariantId={contract.hardwareVariant.id}
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
      {closing && closeCheck.data && (
        <CloseContractDialog
          contractId={contract.id}
          code={contract.code}
          version={closeCheck.data.version}
          onClose={() => setClosing(false)}
        />
      )}
      {reporting && (
        <ReportLossDialog
          deviceId={reporting.deviceId}
          assetTag={reporting.assetTag}
          scope="t"
          onClose={() => setReporting(null)}
          onReported={(reported) => {
            setReporting(null);
            void refresh();
            showToast(`Loss case ${reported.code} opened for ${reporting.assetTag}.`);
          }}
        />
      )}
    </div>
  );
};
