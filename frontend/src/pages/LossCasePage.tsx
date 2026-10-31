import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  confirmLossCase,
  CUSTODY_LABEL,
  DECISION_LABEL,
  decideLossCase,
  isStale,
  LOSS_CASE_STATE,
  lossCaseKeys,
  lossErrorText,
  recoverLossCase,
  triageLossCase,
  useLossCase,
  type LossCase,
  type LossDecision,
} from '../entities/loss-case/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatVnd } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Dialog,
  Field,
  Input,
  PageHeader,
  RadioGroup,
  Skeleton,
  StatusBadge,
  Textarea,
  useToast,
} from '../shared/ui';
import { Fact } from '../shared/ui/bits';
import { invalid } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

const TITLE_ID = 'loss-case-title';
const MSG03 = 'Saved.';

type Action = 'triage' | 'recover' | 'confirm' | 'settle';

// The failure line of an action dialog. STALE_VERSION carries Reload (MSG36); any other refusal shows
// the server's message, and a state refusal also refetches the case (screen 4.4 States).
const Failure: React.FC<{ failure: unknown; onReload: () => void }> = ({ failure, onReload }) => (
  <Alert
    tone="error"
    action={
      isStale(failure) ? (
        <Button size="sm" onClick={onReload}>
          Reload
        </Button>
      ) : undefined
    }
  >
    {lossErrorText(failure)}
  </Alert>
);

interface DialogProps {
  item: LossCase;
  onDone: (updated: LossCase) => void;
  onFailed: (failure: unknown) => void;
  onReload: () => void;
  onClose: () => void;
}

// The shared run of an action: pending state, the failure kept in the dialog, and the case handed
// back on success.
const useRun = (onDone: (updated: LossCase) => void, onFailed: (failure: unknown) => void) => {
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const run = async (call: () => Promise<LossCase>) => {
    setPending(true);
    setFailure(null);
    try {
      onDone(await call());
    } catch (error) {
      setPending(false);
      setFailure(error);
      onFailed(error);
    }
  };
  return { pending, failure, run };
};

const TriageDialog: React.FC<DialogProps> = ({ item, onDone, onFailed, onReload, onClose }) => {
  const [suspected, setSuspected] = useState(false);
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | undefined>();
  const { pending, failure, run } = useRun(onDone, onFailed);
  const submit = () => {
    if (reference.trim().length > 60) {
      setError('Police reference is at most 60 characters.');
      return;
    }
    setError(undefined);
    void run(() =>
      triageLossCase(item, { suspectedTheft: suspected, policeReference: reference.trim() || null }),
    );
  };
  return (
    <Dialog
      titleId="triage-title"
      title={`Triage ${item.code}`}
      description="Custody is decided from the contract interval that holds the last seen time. A renter custody exposes the organization's channel key."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Triaging" onClick={submit}>
            Triage
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Checkbox
          id="triage-theft"
          label="Suspected theft or fraud"
          description="Opens or links a compliance case for the renting organization."
          checked={suspected}
          onChange={(event) => setSuspected(event.target.checked)}
        />
        <Field id="triage-reference" label="Police reference" error={error}>
          <Input
            id="triage-reference"
            maxLength={60}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            {...invalid('triage-reference', error)}
          />
        </Field>
        {failure !== null && <Failure failure={failure} onReload={onReload} />}
      </div>
    </Dialog>
  );
};

const RecoverDialog: React.FC<DialogProps> = ({ item, onDone, onFailed, onReload, onClose }) => {
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();
  const { pending, failure, run } = useRun(onDone, onFailed);
  const submit = () => {
    const text = note.trim();
    if (text === '' || text.length > 500) {
      setError(text === '' ? 'Note is required.' : 'Note is at most 500 characters.');
      return;
    }
    setError(undefined);
    void run(() => recoverLossCase(item, text));
  };
  return (
    <Dialog
      titleId="recover-title"
      title={`Record ${item.device.assetTag} as recovered?`}
      description="The device returns as RETURNED and needs a reset and an inspection before rent."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Recording" onClick={submit}>
            Record recovery
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="recover-note" label="Note" hint="Where and how it was found." error={error} required>
          <Textarea
            id="recover-note"
            rows={3}
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            {...invalid('recover-note', error)}
          />
        </Field>
        {failure !== null && <Failure failure={failure} onReload={onReload} />}
      </div>
    </Dialog>
  );
};

const ConfirmLossDialog: React.FC<DialogProps> = ({ item, onDone, onFailed, onReload, onClose }) => {
  const { pending, failure, run } = useRun(onDone, onFailed);
  return (
    <Dialog
      titleId="confirm-title"
      title={`Confirm ${item.device.assetTag} lost?`}
      description={
        item.custody === 'RENTER'
          ? 'The search ends now. The device remaining value is charged to the renting contract.'
          : 'The search ends now. A loss in TrekLink custody is not charged to any organization.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={pending}
            loadingLabel="Confirming"
            onClick={() => void run(() => confirmLossCase(item))}
          >
            Confirm loss
          </Button>
        </>
      }
    >
      {failure !== null && <Failure failure={failure} onReload={onReload} />}
    </Dialog>
  );
};

const SettleDialog: React.FC<DialogProps> = ({ item, onDone, onFailed, onReload, onClose }) => {
  const renter = item.custody === 'RENTER';
  const options = (renter ? ['CHARGED', 'REDUCED', 'WAIVED'] : ['WRITTEN_OFF']) as LossDecision[];
  const [decision, setDecision] = useState<LossDecision | undefined>(renter ? undefined : 'WRITTEN_OFF');
  const [charge, setCharge] = useState(item.chargeVnd !== null ? String(item.chargeVnd) : '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ decision?: string; charge?: string; reason?: string }>({});
  const { pending, failure, run } = useRun(onDone, onFailed);
  const confirmed = item.chargeVnd ?? 0;

  const submit = () => {
    const amount = Number(charge);
    const missing = {
      decision: decision === undefined ? 'Decision is required.' : undefined,
      charge:
        decision === 'REDUCED' && (charge.trim() === '' || !Number.isInteger(amount) || amount < 0 || amount >= confirmed)
          ? `A reduced charge is a whole amount below ${formatVnd(confirmed)}.`
          : undefined,
      reason:
        decision !== undefined && decision !== 'CHARGED' && reason.trim() === ''
          ? 'Reason is required.'
          : reason.trim().length > 500
            ? 'Reason is at most 500 characters.'
            : undefined,
    };
    setErrors(missing);
    if (decision === undefined || missing.charge || missing.reason) return;
    void run(() =>
      decideLossCase(item, {
        decision,
        chargeVnd: decision === 'REDUCED' ? amount : null,
        reason: reason.trim() || null,
      }),
    );
  };

  return (
    <Dialog
      titleId="settle-title"
      title={`Settle ${item.code}`}
      description={
        renter
          ? `Charge raised at confirmation: ${formatVnd(confirmed)}. The device is retired when the case settles.`
          : 'A loss in TrekLink custody is written off. The device is retired when the case settles.'
      }
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Settling" onClick={submit}>
            Settle
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <RadioGroup
          name="settle-decision"
          legend="Decision"
          options={options.map((value) => ({ value, label: DECISION_LABEL[value] }))}
          value={decision}
          onChange={setDecision}
          error={errors.decision}
          required
        />
        {decision === 'REDUCED' && (
          <Field id="settle-charge" label="Charge (VND)" error={errors.charge} required>
            <Input
              id="settle-charge"
              inputMode="numeric"
              value={charge}
              onChange={(event) => setCharge(event.target.value.replace(/[^0-9]/g, ''))}
              {...invalid('settle-charge', errors.charge)}
            />
          </Field>
        )}
        <Field id="settle-reason" label="Reason" error={errors.reason} required={decision !== 'CHARGED'}>
          <Textarea
            id="settle-reason"
            rows={3}
            maxLength={500}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('settle-reason', errors.reason)}
          />
        </Field>
        {failure !== null && <Failure failure={failure} onReload={onReload} />}
      </div>
    </Dialog>
  );
};

// /t/loss-cases/:id, screen 4.4 (devices api-design 19 to 22 and 27; UC-60). Staff triage, record a
// recovery and confirm; an Admin who did not triage the case settles it (BR-39), the control hidden
// for the triager. Each action refetches the case and the lists, and the device.
export const LossCasePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const detail = useLossCase(id);
  const [action, setAction] = useState<Action | null>(null);
  const [focusSignal, setFocusSignal] = useState(0);
  const item = detail.data;

  useEffect(() => {
    if (focusSignal > 0) document.getElementById(TITLE_ID)?.focus();
  }, [focusSignal]);

  const refreshAll = async (deviceId: string) => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: lossCaseKeys.all }),
      queryClient.invalidateQueries({ queryKey: lossCaseKeys.detail(id ?? '') }),
      queryClient.invalidateQueries({ queryKey: ['device', deviceId] }),
    ]);
  };

  if (detail.isLoading) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading the loss case</span>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (detail.error || !item) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <PageHeader
          id={TITLE_ID}
          title="Loss case"
          breadcrumb={[{ label: 'Loss cases', to: '/t/loss-cases' }, { label: 'Case' }]}
        />
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          }
        >
          {lossErrorText(detail.error)}
        </Alert>
      </section>
    );
  }

  const done = (updated: LossCase) => {
    queryClient.setQueryData(lossCaseKeys.detail(updated.id), updated);
    void refreshAll(updated.device.id);
    setAction(null);
    showToast(MSG03);
    setFocusSignal((signal) => signal + 1);
  };
  // A state refusal means the case moved on: refetch it so the page shows the current state.
  const failed = (failure: unknown) => {
    if (failure instanceof ApiError && failure.errorCode === 'INVALID_STATE_TRANSITION') {
      void detail.refetch();
    }
  };
  const reload = () => {
    setAction(null);
    void refreshAll(item.device.id);
  };
  const props = { item, onDone: done, onFailed: failed, onReload: reload, onClose: () => setAction(null) };

  const canTriage = item.state === 'REPORTED';
  const canRecover =
    item.state === 'REPORTED' || item.state === 'SEARCHING' || item.state === 'SETTLED';
  const canConfirm = item.state === 'SEARCHING';
  const canSettle = isAdmin && item.state === 'CONFIRMED' && item.triagedById !== user?.id;

  return (
    <section aria-labelledby={TITLE_ID}>
      <PageHeader
        id={TITLE_ID}
        title={`${item.code}, ${LOSS_CASE_STATE[item.state].label}`}
        breadcrumb={[{ label: 'Loss cases', to: '/t/loss-cases' }, { label: item.code }]}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge entry={LOSS_CASE_STATE[item.state]} />
            <Link to={`/t/devices/${item.device.id}`} className={`${LINK} font-mono`}>
              {item.device.assetTag}
            </Link>
            {item.organization && <span className="font-mono">{item.organization.code}</span>}
          </span>
        }
      />

      {item.keyExposed && (
        <Alert tone="warning" className="mb-4">
          This organization&apos;s channel key is exposed. Rotate it.{' '}
          <Link to="/t/compliance-cases" className={LINK}>
            Open compliance and key rotation
          </Link>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card aria-labelledby="report-title">
          <h2 id="report-title" className="mb-3 text-title-sm text-ink">
            Report
          </h2>
          <p className="whitespace-pre-line text-body text-ink">{item.description}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Fact label="Reported">{formatDateTime(item.reportedAt)}</Fact>
            <Fact label="Device state when reported">{item.stateFromDevice}</Fact>
            <Fact label="Last seen">{item.lastSeenAt ? formatDateTime(item.lastSeenAt) : 'Never heard'}</Fact>
            <Fact label="Last position">
              {item.lastPosition
                ? `${item.lastPosition.lat.toFixed(5)}, ${item.lastPosition.lon.toFixed(5)}`
                : 'Position unavailable'}
            </Fact>
          </dl>
        </Card>

        <Card aria-labelledby="resolution-title">
          <h2 id="resolution-title" className="mb-3 text-title-sm text-ink">
            Custody and settlement
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Custody">{item.custody ? CUSTODY_LABEL[item.custody] : 'Not triaged yet'}</Fact>
            <Fact label="Channel key exposed">{item.keyExposed ? 'Yes' : 'No'}</Fact>
            <Fact label="Suspected theft or fraud">{item.suspectedTheft ? 'Yes' : 'No'}</Fact>
            <Fact label="Police reference">{item.policeReference ?? 'None'}</Fact>
            <Fact label="Search ends">{item.searchEndsAt ? formatDateTime(item.searchEndsAt) : 'Not started'}</Fact>
            <Fact label="Charge">{item.chargeVnd !== null ? formatVnd(item.chargeVnd) : 'None'}</Fact>
            <Fact label="Decision">{item.decision ? DECISION_LABEL[item.decision] : 'Not settled'}</Fact>
          </dl>
        </Card>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {canTriage && (
          <Button variant="primary" className="min-h-11 w-full sm:w-auto" onClick={() => setAction('triage')}>
            Triage
          </Button>
        )}
        {canRecover && (
          <Button className="min-h-11 w-full sm:w-auto" onClick={() => setAction('recover')}>
            Record recovery
          </Button>
        )}
        {canConfirm && (
          <Button variant="danger" className="min-h-11 w-full sm:w-auto" onClick={() => setAction('confirm')}>
            Confirm loss
          </Button>
        )}
        {canSettle && (
          <Button variant="primary" className="min-h-11 w-full sm:w-auto" onClick={() => setAction('settle')}>
            Settle
          </Button>
        )}
      </div>

      {action === 'triage' && <TriageDialog {...props} />}
      {action === 'recover' && <RecoverDialog {...props} />}
      {action === 'confirm' && <ConfirmLossDialog {...props} />}
      {action === 'settle' && <SettleDialog {...props} />}
    </section>
  );
};
