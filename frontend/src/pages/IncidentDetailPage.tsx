import React, { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  acknowledge,
  actionsFor,
  addStatus,
  declareFalseAlarm,
  incidentKeys,
  markResponding,
  resolve,
  deadlineOf,
  SAR_DISCLAIMER,
  SOURCE_LABEL,
  useIncident,
  type IncidentAction,
  type IncidentDetail,
} from '../entities/incident/api';
import { StateBadges } from '../entities/incident/ui';
import { AlertLog, TransitionTrail } from '../widgets/IncidentHistory/IncidentHistory';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { ErrorState, Fact, Loading, PageTitle } from '../shared/ui/bits';
import { Button } from '../shared/ui/Button';
import { Field, Textarea } from '../shared/ui/Field';
import { messageOf } from '../shared/ui/errors';
import { INCIDENT_STATE } from '../shared/ui/status';
import { useToast } from '../shared/ui/toastStore';
import { ALERT, CARD, LINK, WARNING } from '../shared/ui/styles';

const MSG03 = 'Saved.';

// MSG28 names the state; MSG27 and MSG36 come from the server message (D-057); MSG26 for 403 and 404.
const failureOf = (error: unknown, incident: IncidentDetail): string =>
  error instanceof ApiError && error.errorCode === 'INVALID_STATE_TRANSITION'
    ? `This cannot be done while it is ${INCIDENT_STATE[incident.state].label}.`
    : messageOf(error);

interface FormSpec {
  title: string;
  field: string;
  required: boolean;
  submit: string;
  prompt?: (incident: IncidentDetail) => string;
  danger?: boolean;
}

const FORMS: Record<Exclude<IncidentAction, 'acknowledge'>, FormSpec> = {
  responding: {
    title: 'Response under way',
    field: 'What is being done',
    required: true,
    submit: 'Save response',
  },
  status: { title: 'Add status', field: 'Status update', required: true, submit: 'Save status' },
  resolve: {
    title: 'Report outcome',
    field: 'Outcome',
    required: true,
    submit: 'Resolve incident',
    prompt: (incident) => `Resolve ${incident.code}? A new SOS may reopen this incident.`,
  },
  falseAlarm: {
    title: 'Declare false alarm',
    field: 'Reason',
    required: true,
    submit: 'Declare false alarm',
    prompt: (incident) =>
      `Declare ${incident.code} (${incident.device.assetTag ?? 'unknown device'}) a false alarm?`,
    danger: true,
  },
};

// One action form at a time (screen 8.1 Form fields): a labelled textarea and an explicit submit.
const ActionForm: React.FC<{
  incident: IncidentDetail;
  action: Exclude<IncidentAction, 'acknowledge'>;
  onDone: () => void;
  onCancel: () => void;
}> = ({ incident, action, onDone, onCancel }) => {
  const spec = FORMS[action];
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const id = `incident-${action}`;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (spec.required && !value) {
      setMissing(true);
      return;
    }
    setPending(true);
    setFailure(null);
    try {
      if (action === 'responding') await markResponding(incident.id, incident.version, value);
      if (action === 'status') await addStatus(incident.id, value);
      if (action === 'resolve') await resolve(incident.id, incident.version, value);
      if (action === 'falseAlarm') await declareFalseAlarm(incident.id, incident.version, value);
      onDone();
    } catch (error) {
      // The draft stays for another deliberate attempt; nothing is retried automatically.
      setFailure(failureOf(error, incident));
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className={`${CARD} flex flex-col gap-3`}
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`} className="text-title-sm text-ink">
        {spec.title}
      </h2>
      {spec.prompt && <p className="text-body text-ink">{spec.prompt(incident)}</p>}
      <Field
        id={id}
        label={spec.field}
        required={spec.required}
        error={missing ? 'Please fill in this field.' : undefined}
      >
        <Textarea
          id={id}
          value={text}
          invalid={missing}
          onChange={(event) => {
            setText(event.target.value);
            setMissing(false);
          }}
        />
      </Field>
      {failure && (
        <p role="alert" className={ALERT}>
          {failure}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={spec.danger ? 'danger' : 'primary'} loading={pending}>
          {spec.submit}
        </Button>
        <Button onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </form>
  );
};

const LABELS: Record<IncidentAction, string> = {
  acknowledge: 'Acknowledge',
  responding: 'Response under way',
  status: 'Add status',
  resolve: 'Report outcome',
  falseAlarm: 'Declare false alarm',
};

// /o/incidents/:id, IncidentDetailPage of screen 8.1 (incidents api-design 02 to 07, 12 and 14). The
// primary action changes with the state and the owner; there is no manual escalate, reopen or close.
// The alert log is requested and shown for an Org Manager only.
export const IncidentDetailPage: React.FC = () => {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const { data: incident, isLoading, error, refetch } = useIncident(id);
  const [open, setOpen] = useState<Exclude<IncidentAction, 'acknowledge'> | null>(null);
  const [acking, setAcking] = useState(false);
  const [ackFailure, setAckFailure] = useState<string | null>(null);
  // A panel 404 rechecks access to the main record (screen 8.1).
  const recheck = useCallback(() => void refetch(), [refetch]);

  const settled = async () => {
    setOpen(null);
    showToast(MSG03);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: incidentKeys.detail(id) }),
      queryClient.invalidateQueries({ queryKey: incidentKeys.all }),
    ]);
  };

  if (isLoading) return <Loading />;
  if (error || !incident)
    return (
      <section>
        <Link to="/o/incidents" className={LINK}>
          Back to incidents
        </Link>
        <div className="mt-4">
          <ErrorState error={error} onRetry={() => void refetch()} />
        </div>
      </section>
    );

  const actions = actionsFor(incident, user?.id);
  const [primary, ...secondary] = actions;
  const ownedByOther =
    (incident.state === 'ACKNOWLEDGED' || incident.state === 'RESPONDING') &&
    incident.owner !== null &&
    incident.owner.id !== user?.id;

  // One tap, no required field (screen 8.1); MSG27 names the winner when another member was first.
  const ack = async () => {
    setAcking(true);
    setAckFailure(null);
    try {
      await acknowledge(incident.id, incident.version);
      await settled();
    } catch (failure) {
      setAckFailure(failureOf(failure, incident));
      void refetch();
    } finally {
      setAcking(false);
    }
  };

  const start = (action: IncidentAction) =>
    action === 'acknowledge' ? void ack() : setOpen(action);

  return (
    <section aria-labelledby="incident-title">
      <Link to="/o/incidents" className={LINK}>
        Back to incidents
      </Link>
      <div className="mt-3">
        <PageTitle
          id="incident-title"
          title={incident.code}
          action={<StateBadges incident={incident} />}
        />
      </div>
      <p className={`${WARNING} mb-4`}>{SAR_DISCLAIMER}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className={CARD}>
            <dl className="grid gap-3 sm:grid-cols-2">
              <Fact label="Device">{incident.device.assetTag ?? 'Unknown device'}</Fact>
              <Fact label="Holder">
                {incident.device.holder
                  ? `${incident.device.holder.name}${incident.device.holder.phone ? `, ${incident.device.holder.phone}` : ''}`
                  : 'No holder label'}
              </Fact>
              <Fact label="Owner">{incident.owner?.fullName ?? 'Unclaimed'}</Fact>
              <Fact label="Deadline">{deadlineOf(incident)}</Fact>
              <Fact label="Source">{SOURCE_LABEL[incident.source]}</Fact>
              <Fact label="Events">
                {incident.eventCount}
                {incident.reopenCount > 0 ? `, reopened ${incident.reopenCount} times` : ''}
              </Fact>
              <Fact label="First event">{formatDateTime(incident.firstEventAt)}</Fact>
              <Fact label="Latest episode event">{formatDateTime(incident.lastEventAt)}</Fact>
              <Fact label="Last known coordinates">
                {incident.lastPosition
                  ? `${incident.lastPosition.lat.toFixed(5)}, ${incident.lastPosition.lon.toFixed(5)}`
                  : 'Position unavailable'}
              </Fact>
            </dl>
          </div>

          {ownedByOther && (
            <p className="text-body text-ink">
              {incident.owner?.fullName ?? 'Another member'} owns the response.
            </p>
          )}
          {ackFailure && (
            <p role="alert" className={ALERT}>
              {ackFailure}
            </p>
          )}
          {actions.length > 0 && !open && (
            <div className="flex flex-wrap gap-3">
              <Button
                variant={primary === 'falseAlarm' ? 'danger' : 'primary'}
                loading={primary === 'acknowledge' && acking}
                onClick={() => start(primary)}
              >
                {LABELS[primary]}
              </Button>
              {secondary.map((action) => (
                <Button
                  key={action}
                  variant={action === 'falseAlarm' ? 'danger' : 'secondary'}
                  onClick={() => start(action)}
                >
                  {LABELS[action]}
                </Button>
              ))}
            </div>
          )}
          {open && (
            <ActionForm
              key={open}
              incident={incident}
              action={open}
              onDone={() => void settled()}
              onCancel={() => setOpen(null)}
            />
          )}
        </div>

        <div className="flex flex-col gap-4">
          <section className={CARD} aria-labelledby="status-history">
            <h2 id="status-history" className="mb-3 text-title-sm text-ink">
              Status updates
            </h2>
            {incident.statusUpdates.length === 0 ? (
              <p className="text-body text-ink-muted">No status updates recorded.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {incident.statusUpdates.map((update) => (
                  <li key={update.id}>
                    <p className="text-body-sm text-ink-muted">
                      {update.author.fullName ?? 'A member'}, {formatDateTime(update.createdAt)}
                    </p>
                    <p className="whitespace-pre-wrap break-words text-body text-ink">
                      {update.note}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </section>
          <section className={CARD} aria-labelledby="authority-reports">
            <h2 id="authority-reports" className="mb-3 text-title-sm text-ink">
              Authority reports
            </h2>
            {incident.authorityReports.length === 0 ? (
              <p className="text-body text-ink-muted">No authority reports recorded.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {incident.authorityReports.map((report) => (
                  <li key={report.id} className="text-body text-ink">
                    {report.agency}, {report.reference}, reported{' '}
                    {formatDateTime(report.reportedAt)},{' '}
                    {report.caseClosedAt ? `closed ${formatDateTime(report.caseClosedAt)}` : 'open'}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <TransitionTrail incidentId={incident.id} onLostAccess={recheck} />
          {hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']) && (
            <AlertLog incidentId={incident.id} onLostAccess={recheck} />
          )}
        </div>
      </div>
    </section>
  );
};
