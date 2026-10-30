import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useInvoice, useInvoices } from '../entities/billing/api';
import {
  completeHandover,
  contractKeys,
  fetchHandoverPreview,
  planLabel,
  recordProvisioning,
  STATUS_LABELS,
  STATUS_TONES,
  swapDevice,
  useContract,
  type ContractDetail,
  type ContractDevice,
  type DeviceCheck,
} from '../entities/contract/api';
import { organizationKeys, useMembers, useOrganization } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../shared/lib/format';
import { Badge, ErrorState, Field, Loading, PageTitle } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { Dialog } from '../shared/ui/Dialog';
import { COMPACT_HIDDEN, PageActionBar, StickyPageHeader } from '../shared/ui/PageChrome';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  ERROR_TEXT,
  INPUT,
  LABEL,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  WARNING,
} from '../shared/ui/styles';
import { CounterPaymentDialog } from '../widgets/InvoiceDetail/CounterPaymentDialog';
import { ReturnCounter } from '../widgets/ReturnCounter/ReturnCounter';
import { SignaturePad } from '../widgets/SignaturePad/SignaturePad';

const STEPS = ['Devices', 'Payment', 'Preview note', 'Sign'] as const;
const ZONE_OFFSET_MS = 7 * 60 * 60 * 1000;

interface Check {
  battery: string;
  gpsFixOk: boolean;
}

// The rows a server message names by asset tag (DEVICE_NOT_PROVISIONED, DEVICE_CHECK_FAILED).
const rowsNamed = (devices: ContractDevice[], message: string) =>
  devices.filter((device) => device.assetTag && message.includes(device.assetTag));

const tagOf = (device: ContractDevice) => device.assetTag ?? device.deviceId;

// A battery reading as rentals api-design 10 takes it: a whole number from 0 to 100, else null.
const batteryOf = (value: string): number | null => {
  const battery = Number(value);
  return value.trim() !== '' && Number.isInteger(battery) && battery >= 0 && battery <= 100
    ? battery
    : null;
};

const BATTERY_RULE = 'Enter the battery as a whole number from 0 to 100.';

// The swap dialog of step 1 (rentals api-design 07): the reason is required; with no spare unit the
// handover is held (MSG11, E01-5).
const SwapDialog: React.FC<{
  contract: ContractDetail;
  device: ContractDevice;
  onDone: (message: string) => void;
  onClose: () => void;
}> = ({ contract, device, onDone, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const variant = contract.hardwareVariant.code ?? 'variant';

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason.trim() === '') {
      setError('Reason is required.');
      return;
    }
    setPending(true);
    try {
      const swapped = await swapDevice(contract.id, device.deviceId, reason.trim());
      onDone(
        `Saved. ${swapped.released.assetTag ?? tagOf(device)} went to maintenance; ${swapped.reserved.assetTag} is reserved instead.`,
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'INSUFFICIENT_DEVICES') {
        setError(
          `Only 0 ${variant} devices are available. The handover is held until a unit is free.`,
        );
      } else setError(messageOf(failure));
    }
  };

  return (
    <Dialog
      titleId="swap-title"
      title={`Send ${tagOf(device)} to maintenance and reserve another ${variant}?`}
      onClose={onClose}
    >
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field id="swap-reason" label="What failed" error={error ?? undefined}>
          <textarea
            id="swap-reason"
            rows={3}
            maxLength={300}
            className="rounded-lg border border-line-strong p-3"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('swap-reason', error ?? undefined)}
          />
        </Field>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button type="submit" disabled={pending} className={`${DANGER_BUTTON} flex-1`}>
            {pending ? 'Swapping…' : 'Swap device'}
          </button>
          <button type="button" onClick={onClose} className={`${SECONDARY_BUTTON} flex-1`}>
            Keep it
          </button>
        </div>
      </form>
    </Dialog>
  );
};

// /t/counter/:contractId, the counter handover of screen 5.4 (rentals api-design 07 to 10,
// organizations 03 and 12, billing 08 and 09) in four steps. The signature, the identity text and the
// preview live in memory only and are dropped after the handover.
export const CounterPage: React.FC = () => {
  const { contractId = '' } = useParams();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const contract = useContract(contractId);
  const organizationId = contract.data?.organization?.id;
  const organization = useOrganization(organizationId);
  const members = useMembers(organizationId);
  const invoices = useInvoices('t', { contractId });
  const firstInvoiceId =
    invoices.data?.items
      .slice()
      .sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))
      .at(0)?.id ?? null;
  const firstInvoice = useInvoice(firstInvoiceId);

  const [today] = useState(() => new Date(Date.now() + ZONE_OFFSET_MS).toISOString().slice(0, 10));
  const [step, setStep] = useState(0);
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [provisioned, setProvisioned] = useState<Record<string, number>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const [bulkBattery, setBulkBattery] = useState('');
  const [bulkGps, setBulkGps] = useState<'' | 'ok' | 'none'>('');
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [swapping, setSwapping] = useState<ContractDevice | null>(null);
  const [scan, setScan] = useState('');
  const [scanned, setScanned] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [signerId, setSignerId] = useState('');
  const [identity, setIdentity] = useState('');
  const [signature, setSignature] = useState<string | null>(null);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [lowBattery, setLowBattery] = useState<string | null>(null);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState<{ count: number; code: string } | null>(null);
  const [recordingPayment, setRecordingPayment] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const refetchInvoice = firstInvoice.refetch;

  // The payment may have been recorded elsewhere while step 1 was open: read it again on step 2.
  useEffect(() => {
    if (step === 1) void refetchInvoice();
  }, [step, refetchInvoice]);

  // The readings taken on step 1 go with the preview so the note prints each unit's battery and GPS
  // fix (dry run defect 7, api-design 08 `checks`); a unit without a valid battery is left out.
  const previewChecks: DeviceCheck[] = (contract.data?.devices ?? [])
    .filter((device) => !device.lostAt)
    .flatMap((device) => {
      const check = checks[device.deviceId];
      const batteryPct = check ? batteryOf(check.battery) : null;
      return check && batteryPct !== null
        ? [{ deviceId: device.deviceId, batteryPct, gpsFixOk: check.gpsFixOk }]
        : [];
    });
  const preview = useQuery({
    queryKey: ['handover-preview', contractId, previewChecks] as const,
    queryFn: () => fetchHandoverPreview(contractId, previewChecks),
    enabled: step === 2 && contract.data?.status === 'APPROVED',
    staleTime: 0,
    gcTime: 0,
  });
  const previewUrl = useMemo(() => {
    if (!preview.data?.pdfBase64) return null;
    const bytes = Uint8Array.from(atob(preview.data.pdfBase64), (char) => char.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  }, [preview.data]);
  useEffect(() => () => (previewUrl ? URL.revokeObjectURL(previewUrl) : undefined), [previewUrl]);

  useEffect(() => heading.current?.focus(), [step]);

  if (contract.isLoading) return <Loading label="Loading contract" />;
  if (contract.error || !contract.data) {
    return <ErrorState error={contract.error} onRetry={() => void contract.refetch()} />;
  }
  const data = contract.data;
  const devices = data.devices.filter((device) => !device.lostAt);
  const keyVersion = organization.data?.channelKeyVersion;
  const managers = (members.data ?? []).filter(
    (member) => member.role === 'MANAGER' && !member.deactivatedAt && !member.invitationPending,
  );
  const beforeStart = today < data.requestedStartDate.slice(0, 10);
  const firstLine = firstInvoice.data?.lines.slice().sort((a, b) => a.seq - b.seq)[0];
  const firstPaid = firstLine ? firstLine.paidVnd >= firstLine.amountVnd : false;

  const refreshContract = () =>
    queryClient.invalidateQueries({ queryKey: contractKeys.detail(contractId) });

  const setRowError = (deviceId: string, message: string | null) =>
    setRowErrors((current) => {
      const next = { ...current };
      if (message) next[deviceId] = message;
      else delete next[deviceId];
      return next;
    });

  const checkOf = (deviceId: string): Check => checks[deviceId] ?? { battery: '', gpsFixOk: false };

  const setCheck = (deviceId: string, change: Partial<Check>) =>
    setChecks((current) => ({ ...current, [deviceId]: { ...checkOf(deviceId), ...change } }));

  const findScanned = (event: React.FormEvent) => {
    event.preventDefault();
    const tag = scan.trim();
    if (tag === '') return;
    const match = devices.find((device) => device.assetTag?.toLowerCase() === tag.toLowerCase());
    setScanned(match?.deviceId ?? null);
    setScanError(match ? null : `${tag} does not belong to contract ${data.code}.`);
    setScan('');
  };

  // Records one unit and says whether the server took it; a refusal stays on the row.
  const recordOne = async (device: ContractDevice): Promise<boolean> => {
    if (keyVersion === undefined) return false;
    try {
      const result = await recordProvisioning(data.id, device.deviceId, keyVersion);
      setProvisioned((current) => ({ ...current, [device.deviceId]: result.keyVersion }));
      setRowError(device.deviceId, null);
      return true;
    } catch (failure) {
      if (failure instanceof ApiError && failure.errorCode === 'KEY_VERSION_MISMATCH') {
        void queryClient.invalidateQueries({
          queryKey: organizationKeys.detail(data.organization?.id ?? ''),
        });
        setRowError(
          device.deviceId,
          "Provision this device with the organization's key before handover.",
        );
      } else if (failure instanceof ApiError && failure.errorCode === 'DEVICE_NOT_ON_CONTRACT') {
        setRowError(device.deviceId, `${tagOf(device)} does not belong to contract ${data.code}.`);
      } else setRowError(device.deviceId, messageOf(failure));
      return false;
    }
  };

  const provision = async (device: ContractDevice) => {
    setBusyRow(device.deviceId);
    try {
      await recordOne(device);
    } finally {
      setBusyRow(null);
    }
  };

  // What this visit recorded, else what the server holds, so a reload keeps step 1 (frontend 5.4).
  const versionOf = (device: ContractDevice): number | undefined =>
    provisioned[device.deviceId] ?? device.provisionedKeyVersion ?? undefined;

  // The selection, without units a swap has taken off the contract.
  const selectedIds = selected.filter((id) => devices.some((device) => device.deviceId === id));
  const allSelected = devices.length > 0 && selectedIds.length === devices.length;
  const bulkRunning = bulkProgress !== null;

  const toggleSelected = (deviceId: string, on: boolean) =>
    setSelected((current) =>
      on
        ? [...current.filter((id) => id !== deviceId), deviceId]
        : current.filter((id) => id !== deviceId),
    );

  // Record provisioning for the selection (dry run defect 4): one rentals 09 call per unit, in
  // sequence, so the progress counts up. The first refusal stops the run; the selection keeps the
  // unit that failed and the units not reached, and the server's message stays on the failed row.
  // Units already at the current key version are skipped with a note.
  const provisionSelected = async () => {
    if (keyVersion === undefined) return;
    const chosen = devices.filter((device) => selectedIds.includes(device.deviceId));
    const skipped = chosen.filter((device) => versionOf(device) === keyVersion);
    const todo = chosen.filter((device) => versionOf(device) !== keyVersion);
    const skipNote =
      skipped.length > 0
        ? ` Skipped ${skipped.map(tagOf).join(', ')}: already provisioned v${keyVersion}.`
        : '';
    setBulkNote(null);
    let recorded = 0;
    let stoppedAt: number | null = null;
    for (const [index, device] of todo.entries()) {
      setBulkProgress({ done: index, total: todo.length });
      setBusyRow(device.deviceId);
      if (!(await recordOne(device))) {
        stoppedAt = index;
        break;
      }
      recorded += 1;
    }
    setBusyRow(null);
    setBulkProgress(null);
    if (stoppedAt === null) {
      setSelected([]);
      setBulkNote(`Recorded ${recorded} of ${todo.length}.${skipNote}`);
    } else {
      setSelected(todo.slice(stoppedAt).map((device) => device.deviceId));
      setBulkNote(
        `Stopped at ${tagOf(todo[stoppedAt])}: ${recorded} of ${todo.length} recorded. The selection keeps the unit that failed and the units not reached.${skipNote}`,
      );
    }
  };

  // Set the battery, the GPS fix or both once for the selection; an empty value leaves it as is.
  const applyReadings = (event: React.FormEvent) => {
    event.preventDefault();
    const battery = bulkBattery.trim();
    if (battery !== '' && batteryOf(battery) === null) {
      setBulkError(BATTERY_RULE);
      return;
    }
    if (battery === '' && bulkGps === '') {
      setBulkError('Enter a battery reading or choose a GPS fix.');
      return;
    }
    setBulkError(null);
    setChecks((current) => {
      const next = { ...current };
      selectedIds.forEach((deviceId) => {
        next[deviceId] = {
          ...(current[deviceId] ?? { battery: '', gpsFixOk: false }),
          ...(battery !== '' ? { battery } : {}),
          ...(bulkGps !== '' ? { gpsFixOk: bulkGps === 'ok' } : {}),
        };
      });
      return next;
    });
    setBulkNote(`Readings set on ${selectedIds.length} units.`);
  };

  // Step 1 is complete when every unit carries the current key version and has a battery reading.
  const devicesReady = () => {
    const errors: Record<string, string> = {};
    devices.forEach((device) => {
      const battery = Number(checkOf(device.deviceId).battery);
      if (versionOf(device) !== keyVersion) {
        errors[device.deviceId] =
          "Provision this device with the organization's key before handover.";
      } else if (
        checkOf(device.deviceId).battery === '' ||
        !Number.isInteger(battery) ||
        battery < 0 ||
        battery > 100
      ) {
        errors[device.deviceId] = BATTERY_RULE;
      } else if (!checkOf(device.deviceId).gpsFixOk) {
        errors[device.deviceId] = 'No GPS fix: swap this device before handover.';
      }
    });
    setRowErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const next = () => {
    if (step === 0 && !devicesReady()) return;
    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  };

  const submit = async (acknowledgeLowBattery: boolean) => {
    const errors: Record<string, string> = {};
    if (!signerId) errors.signer = 'Choose the signing Manager.';
    if (identity.trim() === '') errors.identity = 'Enter the document type and last digits seen.';
    if (!signature) errors.signature = 'The Manager signs in the box.';
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;
    setPending(true);
    setPageError(null);
    try {
      const result = await completeHandover(data.id, {
        signedByMemberId: signerId,
        identityChecked: identity.trim(),
        signaturePng: signature ?? '',
        deviceChecks: devices.map((device) => ({
          deviceId: device.deviceId,
          batteryPct: Number(checkOf(device.deviceId).battery),
          gpsFixOk: checkOf(device.deviceId).gpsFixOk,
        })),
        acknowledgeLowBattery,
        expectedVersion: data.version,
      });
      setSignature(null);
      setIdentity('');
      setLowBattery(null);
      queryClient.removeQueries({ queryKey: ['handover-preview', contractId] });
      await Promise.all([
        refreshContract(),
        queryClient.invalidateQueries({ queryKey: contractKeys.all }),
      ]);
      showToast(
        `Handover complete. ${result.devicesHandedOver} devices issued under contract ${result.code}.`,
      );
      setDone({ count: result.devicesHandedOver, code: result.code });
    } catch (failure) {
      setPending(false);
      if (!(failure instanceof ApiError)) {
        setPageError(messageOf(failure));
        return;
      }
      switch (failure.errorCode) {
        case 'LOW_BATTERY':
          setLowBattery(failure.message);
          return;
        case 'FIRST_PAYMENT_MISSING':
          setPaymentError('The first payment is not recorded yet.');
          setStep(1);
          return;
        case 'DEVICE_NOT_PROVISIONED':
          setRowErrors(
            Object.fromEntries(
              rowsNamed(devices, failure.message).map((device) => [
                device.deviceId,
                "Provision this device with the organization's key before handover.",
              ]),
            ),
          );
          setProvisioned({});
          // The server's record is the truth now: reload it rather than trust the cached versions.
          void queryClient.invalidateQueries({ queryKey: contractKeys.detail(contractId) });
          setStep(0);
          return;
        case 'DEVICE_CHECK_FAILED':
          setRowErrors(
            Object.fromEntries(
              rowsNamed(devices, failure.message).map((device) => [
                device.deviceId,
                'This device failed the GPS check. Swap it before handover.',
              ]),
            ),
          );
          setStep(0);
          return;
        case 'SIGNER_NOT_MANAGER':
          setFormErrors({ signer: failure.message });
          return;
        case 'STALE_VERSION':
          setStale(true);
          return;
        case 'INVALID_STATE_TRANSITION':
          void refreshContract();
          setPageError(failure.message);
          return;
        default:
          setPageError(messageOf(failure));
      }
    }
  };

  if (done) {
    return (
      <section aria-labelledby="counter-title" className="flex flex-col gap-5">
        <PageTitle id="counter-title" title={`Handover of ${done.code}`} />
        <div role="status" className={CARD}>
          <p className="text-ink">
            {done.count} devices issued. The contract is active and the signed note is stored.
          </p>
          <Link to={`/t/contracts/${data.id}`} className={`${LINK} mt-3 inline-block`}>
            Open the contract and the handover note
          </Link>
        </div>
      </section>
    );
  }

  if (data.status !== 'APPROVED') {
    // Past the handover the same route is screen 5.5: check-in, reset and inspection, close.
    return (
      <section aria-labelledby="counter-title" className="flex flex-1 flex-col">
        <ReturnCounter
          contract={data}
          header={
            <>
              <Link to={`/t/contracts/${data.id}`} className={`${LINK} text-sm ${COMPACT_HIDDEN}`}>
                Back to the contract
              </Link>
              <PageTitle
                id="counter-title"
                title={`Counter: ${data.code}`}
                action={
                  <Badge tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Badge>
                }
              />
              <p className={`-mt-3 mb-5 text-ink-muted ${COMPACT_HIDDEN}`}>
                {data.organization
                  ? `${data.organization.code}, ${data.organization.legalName.replace(/\.$/, '')}. `
                  : ''}
                {planLabel(data)}, {data.quantity} x {data.hardwareVariant.code ?? 'variant'}
                {data.returnDueAt ? `, return due ${formatDay(data.returnDueAt.slice(0, 10))}` : ''}
              </p>
            </>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="counter-title" className="flex flex-1 flex-col">
      <StickyPageHeader>
        <Link to={`/t/contracts/${data.id}`} className={`${LINK} text-sm ${COMPACT_HIDDEN}`}>
          Back to the contract
        </Link>
        <PageTitle
          id="counter-title"
          title={`Counter handover: ${data.code}`}
          action={<Badge tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Badge>}
        />
        <p className={`-mt-3 mb-5 text-ink-muted ${COMPACT_HIDDEN}`}>
          {data.organization
            ? `${data.organization.code}, ${data.organization.legalName.replace(/\.$/, '')}. `
            : ''}
          {planLabel(data)}, {data.quantity} x {data.hardwareVariant.code ?? 'variant'}, from{' '}
          {formatDay(data.requestedStartDate)}
          {data.handoverAppointmentAt
            ? `. Handover appointment ${formatDateTime(data.handoverAppointmentAt)}`
            : ''}
        </p>
        <ol className="mb-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="Steps">
          {STEPS.map((label, index) => (
            <li
              key={label}
              aria-current={index === step ? 'step' : undefined}
              className={`rounded-lg border px-3 py-2 font-semibold group-data-[compact=true]/chrome:py-1 ${
                index === step ? '' : 'group-data-[compact=true]/chrome:max-sm:hidden'
              } ${
                index === step
                  ? 'border-accent bg-chrome text-ink'
                  : index < step
                    ? 'border-status-done-line bg-status-done-tint text-status-done-fg'
                    : 'border-line bg-surface text-ink-muted'
              }`}
            >
              {index + 1}. {label}
            </li>
          ))}
        </ol>
      </StickyPageHeader>

      {beforeStart && (
        <div role="status" className={`${WARNING} mb-5`}>
          Handover is possible from {formatDay(data.requestedStartDate)}.
        </div>
      )}
      {stale && (
        <div role="alert" className={`${ALERT} mb-5 flex items-center justify-between gap-3`}>
          <span>Someone else changed this. Reload to see the latest.</span>
          <button
            type="button"
            className="font-semibold underline"
            onClick={() => {
              setStale(false);
              void refreshContract();
            }}
          >
            Reload
          </button>
        </div>
      )}

      <div className={CARD}>
        <h2 ref={heading} tabIndex={-1} className="mb-4 text-lg font-bold text-ink">
          {step + 1}. {STEPS[step]}
        </h2>

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <form onSubmit={findScanned} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="scan" className="text-sm font-semibold text-ink">
                  Scan or type an asset tag
                </label>
                <input
                  id="scan"
                  autoFocus
                  className={INPUT}
                  value={scan}
                  onChange={(event) => setScan(event.target.value)}
                  {...invalid('scan', scanError ?? undefined)}
                />
              </div>
              <button type="submit" className={SECONDARY_BUTTON}>
                Find
              </button>
              <p aria-live="polite" className="w-full text-sm">
                {scanError ? (
                  <span id="scan-error" className="text-status-critical-fg">
                    {scanError}
                  </span>
                ) : scanned ? (
                  `${tagOf(devices.find((device) => device.deviceId === scanned) ?? devices[0])} is on this contract.`
                ) : null}
              </p>
            </form>

            <p className="text-sm text-ink-muted">
              Write channel key version {keyVersion ?? '…'} to each unit, then record it, read the
              battery and check the GPS fix.
            </p>
            {organization.error && <ErrorState error={organization.error} />}

            <div className="flex flex-col gap-3 rounded-control border border-line p-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className={`flex h-11 items-center gap-2 ${LABEL}`}>
                  <input
                    type="checkbox"
                    className="h-5 w-5"
                    checked={allSelected}
                    ref={(box) => {
                      if (box) box.indeterminate = selectedIds.length > 0 && !allSelected;
                    }}
                    disabled={bulkRunning}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked ? devices.map((device) => device.deviceId) : [],
                      )
                    }
                  />
                  Select all units
                </label>
                <span className="text-body-sm text-ink-muted">
                  {selectedIds.length} of {devices.length} selected
                </span>
                <button
                  type="button"
                  className={SECONDARY_BUTTON}
                  disabled={
                    selectedIds.length === 0 ||
                    bulkRunning ||
                    busyRow !== null ||
                    keyVersion === undefined
                  }
                  onClick={() => void provisionSelected()}
                >
                  {bulkProgress
                    ? `Recording ${bulkProgress.done + 1} of ${bulkProgress.total}…`
                    : 'Record provisioning for selected'}
                </button>
              </div>
              <form onSubmit={applyReadings} noValidate className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-battery" className={LABEL}>
                    Battery % for selected
                  </label>
                  <input
                    id="bulk-battery"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={100}
                    className={`${INPUT} w-32`}
                    value={bulkBattery}
                    onChange={(event) => setBulkBattery(event.target.value)}
                    {...invalid('bulk-battery', bulkError ?? undefined)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="bulk-gps" className={LABEL}>
                    GPS fix for selected
                  </label>
                  <select
                    id="bulk-gps"
                    className={INPUT}
                    value={bulkGps}
                    onChange={(event) => setBulkGps(event.target.value as '' | 'ok' | 'none')}
                  >
                    <option value="">Leave as is</option>
                    <option value="ok">GPS fix</option>
                    <option value="none">No GPS fix</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className={SECONDARY_BUTTON}
                  disabled={selectedIds.length === 0 || bulkRunning}
                >
                  Set readings for selected
                </button>
                {bulkError && (
                  <p id="bulk-battery-error" role="alert" className={`w-full ${ERROR_TEXT}`}>
                    {bulkError}
                  </p>
                )}
              </form>
              <p aria-live="polite" className="text-body-sm text-ink">
                {bulkProgress
                  ? `Recording provisioning: ${bulkProgress.done} of ${bulkProgress.total} done.`
                  : bulkNote}
              </p>
            </div>

            <ul className="flex flex-col gap-3">
              {devices.map((device) => {
                const check = checkOf(device.deviceId);
                const error = rowErrors[device.deviceId];
                return (
                  <li
                    key={device.deviceId}
                    className={`rounded-lg border p-4 ${
                      scanned === device.deviceId
                        ? 'border-focus bg-chrome'
                        : error
                          ? 'border-status-critical-line'
                          : 'border-line'
                    }`}
                  >
                    <div className="grid items-end gap-3 md:grid-cols-[auto_1fr_auto_120px_auto_auto]">
                      <label className="flex h-11 items-center">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          aria-label={`Select ${tagOf(device)}`}
                          checked={selectedIds.includes(device.deviceId)}
                          disabled={bulkRunning}
                          onChange={(event) =>
                            toggleSelected(device.deviceId, event.target.checked)
                          }
                        />
                      </label>
                      <div>
                        <p className="font-mono font-semibold text-ink">{tagOf(device)}</p>
                        <p className="text-sm text-ink-muted">
                          {versionOf(device)
                            ? `Provisioned v${versionOf(device)}`
                            : 'Not provisioned yet'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        disabled={
                          busyRow === device.deviceId || bulkRunning || keyVersion === undefined
                        }
                        onClick={() => void provision(device)}
                      >
                        {busyRow === device.deviceId ? 'Recording…' : 'Record provisioning'}
                      </button>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`battery-${device.deviceId}`}
                          className="text-sm font-semibold text-ink"
                        >
                          Battery %
                        </label>
                        <input
                          id={`battery-${device.deviceId}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={100}
                          className={INPUT}
                          value={check.battery}
                          onChange={(event) =>
                            setCheck(device.deviceId, { battery: event.target.value })
                          }
                        />
                      </div>
                      <label className="flex h-11 items-center gap-2 text-sm font-semibold text-ink">
                        <input
                          type="checkbox"
                          className="h-5 w-5"
                          checked={check.gpsFixOk}
                          onChange={(event) =>
                            setCheck(device.deviceId, { gpsFixOk: event.target.checked })
                          }
                        />
                        GPS fix
                      </label>
                      <button
                        type="button"
                        className={DANGER_BUTTON}
                        disabled={bulkRunning}
                        onClick={() => setSwapping(device)}
                      >
                        Swap
                      </button>
                    </div>
                    {error && (
                      <p role="alert" className="mt-2 text-sm text-status-critical-fg">
                        {error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {step === 1 && (
          <div className="flex flex-col gap-3" aria-live="polite">
            {(invoices.isLoading || firstInvoice.isLoading) && <Loading />}
            {invoices.error && <ErrorState error={invoices.error} />}
            {firstLine && firstInvoice.data && (
              <dl className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <dt className="font-semibold text-ink-muted">Invoice</dt>
                  <dd>{firstInvoice.data.number}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-muted">{firstLine.description}</dt>
                  <dd>
                    {formatVnd(firstLine.paidVnd)} of {formatVnd(firstLine.amountVnd)} paid
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-ink-muted">Payments</dt>
                  <dd>
                    {firstInvoice.data.payments.length === 0
                      ? 'None yet'
                      : firstInvoice.data.payments
                          .map(
                            (payment) =>
                              `${payment.method}${payment.isSandbox ? ' (sandbox)' : ''}: ${payment.status}`,
                          )
                          .join(', ')}
                  </dd>
                </div>
              </dl>
            )}
            {firstPaid ? (
              <p className="font-semibold text-status-done-fg">The first payment is recorded.</p>
            ) : (
              <p role="alert" className="text-sm text-status-critical-fg">
                {paymentError ?? 'The first payment is not recorded yet.'}
              </p>
            )}
            {firstInvoice.data && !firstPaid && (
              // Recorded here, not on screen 6.3: leaving the page would drop step 1's checks.
              <button
                type="button"
                className={`${SECONDARY_BUTTON} self-start`}
                onClick={() => setRecordingPayment(true)}
              >
                Record a counter payment
              </button>
            )}
            {recordingPayment && firstInvoice.data && (
              <CounterPaymentDialog
                invoice={firstInvoice.data}
                onClose={() => {
                  setRecordingPayment(false);
                  setPaymentError(null);
                }}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <div className="flex flex-col gap-3">
            {preview.isLoading && <Loading label="Rendering the note" />}
            {preview.error && (
              <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
            )}
            {previewUrl && (
              <>
                <iframe
                  title="Handover note preview, not signed"
                  src={previewUrl}
                  className="h-[480px] w-full rounded-lg border border-line"
                />
                <a href={previewUrl} target="_blank" rel="noreferrer" className={`${LINK} text-sm`}>
                  Open the preview in a new tab
                </a>
              </>
            )}
          </div>
        )}

        {step === 3 && (
          <form
            id="handover-sign-form"
            noValidate
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit(false);
            }}
          >
            <Field id="signer" label="Signing Manager" error={formErrors.signer}>
              <select
                id="signer"
                className={INPUT}
                value={signerId}
                onChange={(event) => setSignerId(event.target.value)}
                {...invalid('signer', formErrors.signer)}
              >
                <option value="">Choose a Manager</option>
                {managers.map((member) => (
                  <option key={member.userId} value={member.userId}>
                    {member.fullName ?? member.email ?? member.userId}
                  </option>
                ))}
              </select>
            </Field>
            <Field
              id="identity"
              label="Identity document checked"
              error={formErrors.identity}
              hint="Document type and last digits seen, never the full number."
            >
              <input
                id="identity"
                className={INPUT}
                maxLength={60}
                autoComplete="off"
                value={identity}
                onChange={(event) => setIdentity(event.target.value)}
                {...invalid('identity', formErrors.identity)}
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-ink">Signature</span>
              <SignaturePad
                id="signature"
                invalid={Boolean(formErrors.signature)}
                onChange={setSignature}
              />
              {formErrors.signature && (
                <p role="alert" className="text-sm text-status-critical-fg">
                  {formErrors.signature}
                </p>
              )}
            </div>
            {lowBattery && (
              <div role="alert" className={`${WARNING} flex flex-wrap items-center gap-3`}>
                <span className="flex-1">{lowBattery}</span>
                <button
                  type="button"
                  className="font-semibold underline"
                  disabled={pending}
                  onClick={() => void submit(true)}
                >
                  Proceed anyway
                </button>
              </div>
            )}
            {pageError && (
              <div role="alert" className={ALERT}>
                {pageError}
              </div>
            )}
          </form>
        )}
      </div>

      <PageActionBar
        label="Handover steps"
        start={
          <button
            type="button"
            className={SECONDARY_BUTTON}
            disabled={step === 0}
            onClick={() => setStep((current) => Math.max(current - 1, 0))}
          >
            Back
          </button>
        }
      >
        {step < STEPS.length - 1 ? (
          <button type="button" className={PRIMARY_BUTTON} onClick={next}>
            Next
          </button>
        ) : (
          <button
            type="submit"
            form="handover-sign-form"
            disabled={pending || beforeStart || stale}
            className={PRIMARY_BUTTON}
          >
            {pending ? 'Completing…' : 'Complete handover'}
          </button>
        )}
      </PageActionBar>

      {swapping && (
        <SwapDialog
          contract={data}
          device={swapping}
          onClose={() => setSwapping(null)}
          onDone={(message) => {
            setSwapping(null);
            setRowError(swapping.deviceId, null);
            void refreshContract();
            showToast(message);
          }}
        />
      )}
    </section>
  );
};
