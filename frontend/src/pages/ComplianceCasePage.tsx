import React, { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  ACTION_KIND_LABEL,
  closeComplianceCase,
  complianceCaseKeys,
  needsPoliceReference,
  recordComplianceAction,
  useComplianceCase,
  useOrganizationApiKeys,
  type ComplianceActionKind,
  type ComplianceCase,
} from '../entities/organization/complianceCases';
import { organizationKeys } from '../entities/organization/api';
import { fieldStationKeys, useFieldStations } from '../entities/organization/fieldStations';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import {
  Alert,
  Button,
  Card,
  Dialog,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Textarea,
  useToast,
} from '../shared/ui';
import { Fact } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { caseErrorText, CaseStatusBadge, CaseTypeBadge } from './ComplianceCasesPage';

const TITLE_ID = 'case-title';
const KINDS = Object.keys(ACTION_KIND_LABEL) as ComplianceActionKind[];
const SUSPEND_HINT = 'Ask a TrekLink Admin to suspend the organization.';

const isRevocation = (kind: ComplianceActionKind | '') =>
  kind === 'REVOKE_FIELD_STATION' || kind === 'REVOKE_API_KEY';

// The Target picker of a revocation: an active Field Station (api-design 23) or API key (20) of the
// case's organization.
const TargetField: React.FC<{
  organizationId: string;
  kind: ComplianceActionKind;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}> = ({ organizationId, kind, value, error, onChange }) => {
  const stations = useFieldStations(kind === 'REVOKE_FIELD_STATION' ? organizationId : undefined);
  const keys = useOrganizationApiKeys(organizationId, kind === 'REVOKE_API_KEY');
  const source = kind === 'REVOKE_FIELD_STATION' ? stations : keys;
  const options =
    kind === 'REVOKE_FIELD_STATION'
      ? (stations.data?.items ?? [])
          .filter((station) => !station.revokedAt)
          .map((station) => ({ id: station.id, label: `${station.name} (${station.mqttUsername})` }))
      : (keys.data?.items ?? [])
          .filter((key) => !key.revokedAt)
          .map((key) => ({ id: key.id, label: `${key.name} (${key.prefix})` }));

  if (source.error) {
    return (
      <Alert
        tone="error"
        action={
          <Button size="sm" onClick={() => void source.refetch()}>
            Retry
          </Button>
        }
      >
        {kind === 'REVOKE_API_KEY'
          ? 'The API keys of this organization could not be loaded. Record another action, or try again later.'
          : `The Field Stations of this organization could not be loaded. ${messageOf(source.error)}`}
      </Alert>
    );
  }

  return (
    <Field id="action-target" label="Target" hint="A Field Station or an API key, for a revocation." error={error} required>
      <Select
        id="action-target"
        value={value}
        disabled={source.isLoading}
        onChange={(event) => onChange(event.target.value)}
        {...invalid('action-target', error)}
      >
        <option value="">
          {source.isLoading ? 'Loading' : options.length === 0 ? 'Nothing active to revoke' : 'Choose the target'}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </Select>
    </Field>
  );
};

// The record action dialog of api-design 30. Suspension is an Admin action; Staff see it disabled.
const RecordActionDialog: React.FC<{
  item: ComplianceCase;
  isAdmin: boolean;
  onRecorded: (updated: ComplianceCase, kind: ComplianceActionKind) => void;
  onClose: () => void;
}> = ({ item, isAdmin, onRecorded, onClose }) => {
  const [kind, setKind] = useState<ComplianceActionKind | ''>('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<{ kind?: string; target?: string; note?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const missing = {
      kind: kind === '' ? 'Action is required.' : undefined,
      target: isRevocation(kind) && targetId === '' ? 'Target is required.' : undefined,
      note: note.trim() === '' ? 'Note is required.' : undefined,
    };
    setErrors(missing);
    if (kind === '' || missing.target || missing.note) return;
    setPending(true);
    setError(null);
    try {
      onRecorded(
        await recordComplianceAction(item.id, {
          kind,
          targetId: isRevocation(kind) ? targetId : null,
          note: note.trim(),
        }),
        kind,
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED') {
        const lower = failure.message.toLowerCase();
        if (lower.startsWith('note')) setErrors({ note: failure.message });
        else if (lower.startsWith('target')) setErrors({ target: failure.message });
        else setError(failure.message);
      } else if (failure instanceof ApiError && failure.statusCode === 403 && kind === 'SUSPEND_ORGANIZATION') {
        setError(failure.message);
      } else setError(caseErrorText(failure));
    }
  };

  return (
    <Dialog
      titleId="record-action-title"
      title={`Take an action on ${item.code}`}
      description={`Organization ${item.organization.code}. The action is recorded with your name and the time.`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Recording" onClick={() => void submit()}>
            Record action
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          id="action-kind"
          label="Action"
          hint={isAdmin ? undefined : SUSPEND_HINT}
          error={errors.kind}
          required
        >
          <Select
            id="action-kind"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as ComplianceActionKind | '');
              setTargetId('');
            }}
            {...invalid('action-kind', errors.kind)}
          >
            <option value="">Choose an action</option>
            {KINDS.map((key) => (
              <option key={key} value={key} disabled={key === 'SUSPEND_ORGANIZATION' && !isAdmin}>
                {`${ACTION_KIND_LABEL[key]}${key === 'SUSPEND_ORGANIZATION' && !isAdmin ? ' (Admin only)' : ''}`}
              </option>
            ))}
          </Select>
        </Field>
        {kind !== '' && isRevocation(kind) && (
          <TargetField
            organizationId={item.organization.id}
            kind={kind}
            value={targetId}
            error={errors.target}
            onChange={setTargetId}
          />
        )}
        <Field id="action-note" label="Note" error={errors.note} required>
          <Textarea
            id="action-note"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            {...invalid('action-note', errors.note)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// The close dialog of api-design 31; a fraud or theft case needs the police report reference (BR-40).
const CloseCaseDialog: React.FC<{
  item: ComplianceCase;
  onClosed: (updated: ComplianceCase) => void;
  onClose: () => void;
}> = ({ item, onClosed, onClose }) => {
  const policeRequired = needsPoliceReference(item.type);
  const [outcome, setOutcome] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<{ outcome?: string; reference?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    const missing = {
      outcome: outcome.trim() === '' ? 'Outcome is required.' : undefined,
      reference:
        policeRequired && reference.trim() === '' ? 'Police report reference is required.' : undefined,
    };
    setErrors(missing);
    if (missing.outcome || missing.reference) return;
    setPending(true);
    setError(null);
    try {
      onClosed(
        await closeComplianceCase(item.id, {
          outcome: outcome.trim(),
          ...(reference.trim() ? { authorityReference: reference.trim() } : {}),
        }),
      );
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'POLICE_REFERENCE_REQUIRED') {
        setErrors({ reference: failure.message });
      } else if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED') {
        if (failure.message.toLowerCase().startsWith('outcome')) setErrors({ outcome: failure.message });
        else setError(failure.message);
      } else setError(caseErrorText(failure));
    }
  };

  return (
    <Dialog
      titleId="close-case-title"
      title={`Close case ${item.code}?`}
      description="A closed case is read only: no further actions can be recorded on it."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Closing" onClick={() => void submit()}>
            Close case
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="close-outcome" label="Outcome" error={errors.outcome} required>
          <Textarea
            id="close-outcome"
            rows={3}
            value={outcome}
            onChange={(event) => setOutcome(event.target.value)}
            {...invalid('close-outcome', errors.outcome)}
          />
        </Field>
        <Field
          id="close-reference"
          label="Police report reference"
          hint={policeRequired ? 'Required for a suspected fraud or theft.' : undefined}
          error={errors.reference}
          required={policeRequired}
        >
          <Input
            id="close-reference"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            {...invalid('close-reference', errors.reference)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// /t/compliance-cases/:id, screen 3.6 (organizations api-design 30 to 32; UC-63). An open case offers
// Close case and the actions; a closed case is read only.
export const ComplianceCasePage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { user } = useAuth();
  const isAdmin = hasAnyRole(user?.roles ?? [], ['ADMIN']);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const detail = useComplianceCase(id);
  const [recording, setRecording] = useState(false);
  const [closing, setClosing] = useState(false);
  const [focusHeadingSignal, setFocusHeadingSignal] = useState(() =>
    (location.state as { focusHeading?: boolean } | null)?.focusHeading ? 1 : 0,
  );
  const [focusLastActionSignal, setFocusLastActionSignal] = useState(0);
  const item = detail.data;

  useEffect(() => {
    if (focusHeadingSignal === 0 || !item) return;
    document.getElementById(TITLE_ID)?.focus();
  }, [focusHeadingSignal, item]);

  useEffect(() => {
    if (focusLastActionSignal === 0 || !item) return;
    document.getElementById(`case-action-${item.actions.length - 1}`)?.focus();
  }, [focusLastActionSignal, item]);

  const settle = (updated: ComplianceCase) => {
    queryClient.setQueryData(complianceCaseKeys.detail(updated.id), updated);
    void queryClient.invalidateQueries({ queryKey: complianceCaseKeys.all });
    void queryClient.invalidateQueries({ queryKey: complianceCaseKeys.detail(updated.id) });
  };

  if (detail.isLoading) {
    return (
      <div role="status" className="flex flex-col gap-4">
        <span className="sr-only">Loading the compliance case</span>
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (detail.error || !item) {
    return (
      <section aria-labelledby={TITLE_ID}>
        <PageHeader
          id={TITLE_ID}
          title="Compliance case"
          breadcrumb={[{ label: 'Compliance cases', to: '/t/compliance-cases' }, { label: 'Case' }]}
        />
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={() => void detail.refetch()}>
              Try again
            </Button>
          }
        >
          {detail.error ? caseErrorText(detail.error) : 'Something went wrong.'}
        </Alert>
      </section>
    );
  }

  const open = item.status === 'OPEN';

  return (
    <section aria-labelledby={TITLE_ID}>
      <PageHeader
        id={TITLE_ID}
        title={`${item.code}, ${open ? 'Open' : 'Closed'}`}
        breadcrumb={[{ label: 'Compliance cases', to: '/t/compliance-cases' }, { label: item.code }]}
        meta={
          <span className="inline-flex flex-wrap items-center gap-2">
            <CaseTypeBadge type={item.type} />
            <CaseStatusBadge status={item.status} />
            <span className="font-mono">{item.organization.code}</span>
          </span>
        }
        actions={
          open && (
            <Button className="w-full sm:w-auto" onClick={() => setRecording(true)}>
              Take an action
            </Button>
          )
        }
        primaryAction={
          open && (
            <Button variant="primary" className="w-full sm:w-auto" onClick={() => setClosing(true)}>
              Close case
            </Button>
          )
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card aria-labelledby="evidence-title">
          <h2 id="evidence-title" className="mb-3 text-title-sm text-ink">
            Evidence
          </h2>
          <p className="whitespace-pre-line text-body text-ink">{item.evidence}</p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Fact label="Organization">{item.organization.code}</Fact>
            <Fact label="Opened">{formatDateTime(item.openedAt)}</Fact>
            {!open && <Fact label="Outcome">{item.outcome ?? 'Not recorded'}</Fact>}
            {!open && <Fact label="Police report reference">{item.authorityReference ?? 'None'}</Fact>}
          </dl>
        </Card>

        <Card aria-labelledby="actions-title">
          <h2 id="actions-title" className="mb-3 text-title-sm text-ink">
            Actions taken
          </h2>
          {item.actions.length === 0 ? (
            <p className="text-body text-ink-muted">No actions taken yet.</p>
          ) : (
            <ol className="flex flex-col divide-y divide-line">
              {item.actions.map((action, index) => (
                <li
                  key={`${action.kind}-${action.at}-${index}`}
                  id={`case-action-${index}`}
                  tabIndex={-1}
                  className="flex flex-col gap-0.5 py-2.5 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
                >
                  <span className="font-semibold text-ink">{ACTION_KIND_LABEL[action.kind]}</span>
                  <span className="text-body-sm text-ink-muted">
                    {action.actor.fullName}, {formatDateTime(action.at)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card aria-labelledby="linked-title">
          <h2 id="linked-title" className="mb-3 text-title-sm text-ink">
            Linked items
          </h2>
          <dl className="grid gap-3">
            <Fact label="Contracts">
              {item.linkedContractIds.length === 0 ? (
                'None'
              ) : (
                <ul className="flex flex-col gap-1">
                  {item.linkedContractIds.map((contractId) => (
                    <li key={contractId}>
                      <Link to={`/t/contracts/${contractId}`} className={`${LINK} break-all font-mono`}>
                        {contractId}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Fact>
            <Fact label="Loss cases">
              {item.linkedLossCases.length === 0 ? 'None' : item.linkedLossCases.join(', ')}
            </Fact>
          </dl>
        </Card>
      </div>

      {recording && (
        <RecordActionDialog
          item={item}
          isAdmin={isAdmin}
          onClose={() => setRecording(false)}
          onRecorded={(updated, kind) => {
            setRecording(false);
            settle(updated);
            if (kind !== 'OTHER') {
              const organizationId = updated.organization.id;
              void queryClient.invalidateQueries({ queryKey: organizationKeys.all });
              void queryClient.invalidateQueries({ queryKey: organizationKeys.detail(organizationId) });
              void queryClient.invalidateQueries({ queryKey: fieldStationKeys.list(organizationId) });
              void queryClient.invalidateQueries({ queryKey: complianceCaseKeys.apiKeys(organizationId) });
            }
            showToast('Action recorded');
            setFocusLastActionSignal((signal) => signal + 1);
          }}
        />
      )}

      {closing && (
        <CloseCaseDialog
          item={item}
          onClose={() => setClosing(false)}
          onClosed={(updated) => {
            setClosing(false);
            settle(updated);
            showToast('Compliance case closed');
            setFocusHeadingSignal((signal) => signal + 1);
          }}
        />
      )}
    </section>
  );
};
