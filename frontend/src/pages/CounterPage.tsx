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
} from '../entities/contract/api';
import { organizationKeys, useMembers, useOrganization } from '../entities/organization/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../shared/lib/format';
import { Badge, ErrorState, Field, Loading, PageTitle } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { Dialog } from '../shared/ui/Dialog';
import { useToast } from '../shared/ui/toastStore';
import {
  ALERT,
  CARD,
  DANGER_BUTTON,
  INPUT,
  LINK,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  WARNING,
} from '../shared/ui/styles';
import { CounterPaymentDialog } from '../widgets/InvoiceDetail/CounterPaymentDialog';
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
            className="rounded-lg border border-slate-400 p-3"
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

  const preview = useQuery({
    queryKey: ['handover-preview', contractId] as const,
    queryFn: () => fetchHandoverPreview(contractId),
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

  const provision = async (device: ContractDevice) => {
    if (keyVersion === undefined) return;
    setBusyRow(device.deviceId);
    try {
      const result = await recordProvisioning(data.id, device.deviceId, keyVersion);
      setProvisioned((current) => ({ ...current, [device.deviceId]: result.keyVersion }));
      setRowError(device.deviceId, null);
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
    } finally {
      setBusyRow(null);
    }
  };

  // Step 1 is complete when every unit is provisioned in this visit and has a battery reading.
  const devicesReady = () => {
    const errors: Record<string, string> = {};
    devices.forEach((device) => {
      const battery = Number(checkOf(device.deviceId).battery);
      if (provisioned[device.deviceId] !== keyVersion) {
        errors[device.deviceId] =
          "Provision this device with the organization's key before handover.";
      } else if (
        checkOf(device.deviceId).battery === '' ||
        !Number.isInteger(battery) ||
        battery < 0 ||
        battery > 100
      ) {
        errors[device.deviceId] = 'Enter the battery as a whole number from 0 to 100.';
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
          <p className="text-slate-900">
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
    return (
      <section aria-labelledby="counter-title">
        <PageTitle id="counter-title" title={`Counter: ${data.code}`} />
        <div role="alert" className={ALERT}>
          This cannot be done while it is {STATUS_LABELS[data.status]}.{' '}
          <Link to={`/t/contracts/${data.id}`} className="font-semibold underline">
            Open the contract
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="counter-title">
      <Link to={`/t/contracts/${data.id}`} className={`${LINK} text-sm`}>
        Back to the contract
      </Link>
      <PageTitle
        id="counter-title"
        title={`Counter handover: ${data.code}`}
        action={<Badge tone={STATUS_TONES[data.status]}>{STATUS_LABELS[data.status]}</Badge>}
      />
      <p className="-mt-3 mb-5 text-slate-700">
        {data.organization
          ? `${data.organization.code}, ${data.organization.legalName.replace(/\.$/, '')}. `
          : ''}
        {planLabel(data)}, {data.quantity} x {data.hardwareVariant.code ?? 'variant'}, from{' '}
        {formatDay(data.requestedStartDate)}
        {data.handoverAppointmentAt
          ? `. Handover appointment ${formatDateTime(data.handoverAppointmentAt)}`
          : ''}
      </p>

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

      <ol className="mb-5 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? 'step' : undefined}
            className={`rounded-lg border px-3 py-2 font-semibold ${
              index === step
                ? 'border-blue-700 bg-blue-50 text-blue-800'
                : index < step
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                  : 'border-slate-200 bg-white text-slate-600'
            }`}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      <div className={CARD}>
        <h2 ref={heading} tabIndex={-1} className="mb-4 text-lg font-bold text-slate-900">
          {step + 1}. {STEPS[step]}
        </h2>

        {step === 0 && (
          <div className="flex flex-col gap-4">
            <form onSubmit={findScanned} className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label htmlFor="scan" className="text-sm font-semibold text-slate-900">
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
                  <span id="scan-error" className="text-red-700">
                    {scanError}
                  </span>
                ) : scanned ? (
                  `${tagOf(devices.find((device) => device.deviceId === scanned) ?? devices[0])} is on this contract.`
                ) : null}
              </p>
            </form>

            <p className="text-sm text-slate-700">
              Write channel key version {keyVersion ?? '…'} to each unit, then record it, read the
              battery and check the GPS fix.
            </p>
            {organization.error && <ErrorState error={organization.error} />}

            <ul className="flex flex-col gap-3">
              {devices.map((device) => {
                const check = checkOf(device.deviceId);
                const error = rowErrors[device.deviceId];
                return (
                  <li
                    key={device.deviceId}
                    className={`rounded-lg border p-4 ${
                      scanned === device.deviceId
                        ? 'border-blue-500 bg-blue-50'
                        : error
                          ? 'border-red-300'
                          : 'border-slate-200'
                    }`}
                  >
                    <div className="grid items-end gap-3 md:grid-cols-[1fr_auto_120px_auto_auto]">
                      <div>
                        <p className="font-mono font-semibold text-slate-900">{tagOf(device)}</p>
                        <p className="text-sm text-slate-600">
                          {provisioned[device.deviceId]
                            ? `Provisioned v${provisioned[device.deviceId]}`
                            : 'Not provisioned in this visit'}
                        </p>
                      </div>
                      <button
                        type="button"
                        className={SECONDARY_BUTTON}
                        disabled={busyRow === device.deviceId || keyVersion === undefined}
                        onClick={() => void provision(device)}
                      >
                        {busyRow === device.deviceId ? 'Recording…' : 'Record provisioning'}
                      </button>
                      <div className="flex flex-col gap-1.5">
                        <label
                          htmlFor={`battery-${device.deviceId}`}
                          className="text-sm font-semibold text-slate-900"
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
                      <label className="flex h-11 items-center gap-2 text-sm font-semibold text-slate-900">
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
                        onClick={() => setSwapping(device)}
                      >
                        Swap
                      </button>
                    </div>
                    {error && (
                      <p role="alert" className="mt-2 text-sm text-red-700">
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
                  <dt className="font-semibold text-slate-600">Invoice</dt>
                  <dd>{firstInvoice.data.number}</dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">{firstLine.description}</dt>
                  <dd>
                    {formatVnd(firstLine.paidVnd)} of {formatVnd(firstLine.amountVnd)} paid
                  </dd>
                </div>
                <div>
                  <dt className="font-semibold text-slate-600">Payments</dt>
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
              <p className="font-semibold text-emerald-800">The first payment is recorded.</p>
            ) : (
              <p role="alert" className="text-sm text-red-700">
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
                  className="h-[480px] w-full rounded-lg border border-slate-200"
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
              <span className="text-sm font-semibold text-slate-900">Signature</span>
              <SignaturePad
                id="signature"
                invalid={Boolean(formErrors.signature)}
                onChange={setSignature}
              />
              {formErrors.signature && (
                <p role="alert" className="text-sm text-red-700">
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
            <button
              type="submit"
              disabled={pending || beforeStart || stale}
              className={PRIMARY_BUTTON}
            >
              {pending ? 'Completing…' : 'Complete handover'}
            </button>
          </form>
        )}
      </div>

      <div className="mt-5 flex justify-between gap-3">
        <button
          type="button"
          className={SECONDARY_BUTTON}
          disabled={step === 0}
          onClick={() => setStep((current) => Math.max(current - 1, 0))}
        >
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button type="button" className={PRIMARY_BUTTON} onClick={next}>
            Next
          </button>
        )}
      </div>

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
