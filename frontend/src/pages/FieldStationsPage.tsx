import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  createFieldStation,
  downloadHref,
  fieldStationKeys,
  revokeFieldStation,
  useFieldStationRelease,
  useFieldStations,
  type CreatedFieldStation,
  type FieldStation,
} from '../entities/organization/fieldStations';
import { ApiError } from '../shared/api/apiClient';
import { formatDate, formatDateTime } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import {
  Alert,
  Badge,
  Button,
  buttonClasses,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  useToast,
  type Column,
} from '../shared/ui';
import { ErrorState, Fact } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';

const TITLE_ID = 'field-stations-title';

// NOT_FOUND names the missing station or organization (SD 3.5 States); other 403 and 404 answers
// read MSG26.
const errorText = (failure: unknown): string =>
  failure instanceof ApiError && failure.errorCode === 'NOT_FOUND' ? failure.message : messageOf(failure);

const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`;

const operatingSystem = (os: string) => (os.startsWith('windows') ? 'Windows' : os.startsWith('mac') ? 'macOS' : os.startsWith('linux') ? 'Linux' : os);

const queueText = (station: FieldStation) =>
  station.queueDepth
    ? `${station.queueDepth.p0} / ${station.queueDepth.p1} / ${station.queueDepth.p2} / ${station.queueDepth.p3}`
    : 'No data yet';

const VersionCell: React.FC<{ station: FieldStation }> = ({ station }) => (
  <span className="flex flex-wrap items-center gap-2">
    <span className="font-mono">{station.version ?? 'Not reported'}</span>
    {!station.revokedAt &&
      (station.outdated ? <Badge tone="attention">Outdated</Badge> : <Badge tone="done">Current</Badge>)}
  </span>
);

const StatusCell: React.FC<{ station: FieldStation }> = ({ station }) =>
  station.revokedAt ? (
    <Badge tone="ended">Revoked {formatDate(station.revokedAt)}</Badge>
  ) : (
    <Badge tone="active">Active</Badge>
  );

// The release card (api-design 26). Its own query: a 503 RELEASE_UNAVAILABLE leaves the table usable.
// RELEASE_UNAVAILABLE means no release is published on this server (no FIELD_STATION_RELEASE_DIR), a
// state of the deployment rather than a failure, so it reads as an empty state; other errors keep Retry.
const ReleaseCard: React.FC<{ organizationId: string }> = ({ organizationId }) => {
  const release = useFieldStationRelease(organizationId);
  const unpublished =
    release.error instanceof ApiError && release.error.errorCode === 'RELEASE_UNAVAILABLE';
  return (
    <Card aria-labelledby="release-title" className="mb-4">
      <h2 id="release-title" className="mb-3 text-title-sm text-ink">
        Field Station software
      </h2>
      {release.isLoading && (
        <div role="status" className="flex flex-col gap-2">
          <span className="sr-only">Loading the release</span>
          <Skeleton className="h-6 w-1/3" />
          <Skeleton className="h-10" />
        </div>
      )}
      {unpublished && (
        <EmptyState
          className="py-6"
          title="No download published yet"
          description="The Field Station software is not published on this server. Ask TrekLink for the installer; the credentials below work with it."
        />
      )}
      {release.error && !unpublished && (
        <Alert
          tone="error"
          action={
            <Button size="sm" onClick={() => void release.refetch()} loading={release.isFetching}>
              Retry
            </Button>
          }
        >
          {errorText(release.error)}
        </Alert>
      )}
      {release.data && (
        <div className="flex flex-col gap-3">
          <dl className="grid gap-3 sm:grid-cols-2">
            <Fact label="Version">{release.data.version}</Fact>
            <Fact label="Published">{formatDateTime(release.data.publishedAt)}</Fact>
          </dl>
          <ul className="flex flex-col divide-y divide-line">
            {release.data.files.map((file) => (
              <li key={file.os} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {operatingSystem(file.os)} <span className="font-normal text-ink-muted">({file.os}, {megabytes(file.sizeBytes)})</span>
                  </p>
                  <p className="break-all font-mono text-body-sm text-ink-muted">SHA-256 {file.sha256}</p>
                </div>
                <a
                  href={downloadHref(file.downloadUrl)}
                  download
                  className={buttonClasses('secondary', 'md', 'w-full sm:w-auto')}
                >
                  Download for {operatingSystem(file.os)}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
};

const CreateDialog: React.FC<{
  organizationId: string;
  onCreated: (created: CreatedFieldStation) => void;
  onClose: () => void;
}> = ({ organizationId, onCreated, onClose }) => {
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (name.trim() === '') {
      setFieldError('Name is required.');
      return;
    }
    setPending(true);
    setFieldError(null);
    setError(null);
    try {
      onCreated(await createFieldStation(organizationId, name.trim()));
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED') setFieldError(failure.message);
      else setError(errorText(failure));
    }
  };

  return (
    <Dialog
      titleId="create-station-title"
      title="Create Field Station"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Creating" onClick={() => void submit()}>
            Create
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-3">
        <Field
          id="station-name"
          label="Name"
          hint="Where the laptop runs, for example."
          error={fieldError ?? undefined}
          required
        >
          <Input
            id="station-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            {...invalid('station-name', fieldError ?? undefined)}
          />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </form>
    </Dialog>
  );
};

const CopyValue: React.FC<{ label: string; value: string }> = ({ label, value }) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return undefined;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-label uppercase text-ink-muted">{label}</p>
      <div className="flex items-start gap-2">
        <code className="min-w-0 flex-1 break-all rounded-control bg-sunken px-3 py-2.5 font-mono text-body-sm text-ink">
          {value}
        </code>
        <Button aria-label={copied ? `${label} copied` : `Copy ${label}`} onClick={() => void copy()}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copied ? `${label} copied` : ''}
      </span>
    </div>
  );
};

// The one-time credential of api-design 24. The secret lives in this dialog's props only.
const CredentialDialog: React.FC<{ created: CreatedFieldStation; onDone: () => void }> = ({ created, onDone }) => (
  <Dialog
    titleId="credential-title"
    title={`Credential for ${created.name}`}
    description="Field Station credential created. Copy it now; it will not be shown again."
    onClose={onDone}
    footer={
      <Button variant="primary" onClick={onDone}>
        Done
      </Button>
    }
  >
    <div className="flex flex-col gap-4">
      <CopyValue label="Broker URL" value={created.brokerUrl} />
      <CopyValue label="Username" value={created.mqttUsername} />
      <CopyValue label="Secret" value={created.mqttSecret} />
    </div>
  </Dialog>
);

const RevokeDialog: React.FC<{
  organizationId: string;
  station: FieldStation;
  onDone: () => void;
  onNotFound: () => void;
  onClose: () => void;
}> = ({ organizationId, station, onDone, onNotFound, onClose }) => {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      await revokeFieldStation(organizationId, station.id, reason.trim() || undefined);
      onDone();
    } catch (failure) {
      setPending(false);
      setError(errorText(failure));
      if (failure instanceof ApiError && failure.errorCode === 'NOT_FOUND') onNotFound();
    }
  };

  return (
    <Dialog
      titleId="revoke-station-title"
      title={`Revoke Field Station ${station.name}?`}
      description="The broker refuses this credential from its next connection; its cache lasts up to 60 seconds. Events the station still holds are delivered once a new credential is configured."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} loadingLabel="Revoking" onClick={() => void submit()}>
            Revoke
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field
          id="revoke-station-reason"
          label="Reason"
          hint="Optional for a Manager. Required when TrekLink Staff or Admin revoke."
        >
          <Input id="revoke-station-reason" value={reason} onChange={(event) => setReason(event.target.value)} />
        </Field>
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// /o/field-stations, screen 3.5 (organizations api-design 23 to 26; UC-06, UC-42). Org Operators read
// it; the Org Manager creates and revokes credentials.
export const FieldStationsPage: React.FC = () => {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const isManager = hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const stations = useFieldStations(organizationId);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedFieldStation | null>(null);
  const [revoking, setRevoking] = useState<FieldStation | null>(null);
  const [focusCreateSignal, setFocusCreateSignal] = useState(0);
  const [focusHeadingSignal, setFocusHeadingSignal] = useState(0);
  const createRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusCreateSignal === 0) return;
    createRef.current?.focus();
  }, [focusCreateSignal]);

  useEffect(() => {
    if (focusHeadingSignal === 0) return;
    document.getElementById(TITLE_ID)?.focus();
  }, [focusHeadingSignal]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: fieldStationKeys.list(organizationId ?? '') });

  const items = stations.data?.items ?? [];
  const active = items.filter((station) => !station.revokedAt);
  const revoked = items.length - active.length;
  const outdated = active.filter((station) => station.outdated).length;
  const limit = stations.data?.limit;
  const atLimit = limit !== undefined && active.length >= limit;
  const countLine =
    limit === undefined
      ? undefined
      : `${active.length} of ${limit} active stations${revoked > 0 ? `, ${revoked} revoked` : ''}`;

  const createButton = isManager && (
    <Button
      ref={createRef}
      variant="primary"
      aria-label="Create Field Station"
      disabled={!stations.data || atLimit}
      onClick={() => setCreating(true)}
    >
      <span className="sm:hidden">Create station</span>
      <span className="hidden sm:inline">Create Field Station</span>
    </Button>
  );

  const columns: Column<FieldStation>[] = [
    {
      key: 'name',
      header: 'Station',
      cell: (station) => (
        <span className="flex flex-col">
          <span className="font-semibold text-ink">{station.name}</span>
          <span className="font-mono text-body-sm text-ink-muted">{station.mqttUsername}</span>
        </span>
      ),
    },
    { key: 'version', header: 'Version', cell: (station) => <VersionCell station={station} /> },
    {
      key: 'lastSync',
      header: 'Last sync',
      cell: (station) => (station.lastSyncAt ? formatDateTime(station.lastSyncAt) : 'Never'),
    },
    { key: 'queue', header: 'Queue p0 / p1 / p2 / p3', cell: queueText },
    { key: 'retry', header: 'Oldest retry', align: 'end', cell: (station) => station.oldestRetryCount },
    { key: 'status', header: 'Status', cell: (station) => <StatusCell station={station} /> },
  ];

  const revokeButton = (station: FieldStation) =>
    isManager && !station.revokedAt ? (
      <Button
        variant="danger"
        size="sm"
        className="min-h-11 sm:min-h-0"
        aria-label={`Revoke ${station.name}`}
        onClick={() => setRevoking(station)}
      >
        Revoke
      </Button>
    ) : null;

  return (
    <section aria-labelledby={TITLE_ID}>
      <PageHeader id={TITLE_ID} title="Field Stations" meta={countLine} primaryAction={createButton || undefined} />

      {organizationId && <ReleaseCard organizationId={organizationId} />}

      {outdated > 0 && (
        <Alert tone="warning" className="mb-4">
          {outdated} of {active.length} active stations {outdated === 1 ? 'runs' : 'run'} an older version. Download
          the current release and replace the executable on that laptop.
        </Alert>
      )}

      <DataTable
        caption="Field Stations"
        columns={columns}
        rows={stations.data?.items}
        rowId={(station) => station.id}
        loading={stations.isLoading}
        error={
          stations.error ? <ErrorState error={stations.error} onRetry={() => void stations.refetch()} /> : undefined
        }
        empty={{
          title: 'No Field Stations yet',
          description: 'Create a credential, then run the Field Station on the laptop at your base.',
        }}
        rowActions={isManager ? revokeButton : undefined}
        renderCard={(station) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-2">
              <span className="flex flex-col">
                <span className="font-semibold text-ink">{station.name}</span>
                <span className="font-mono text-body-sm text-ink-muted">{station.mqttUsername}</span>
              </span>
              <StatusCell station={station} />
            </div>
            <VersionCell station={station} />
            <p className="text-body-sm text-ink-muted">
              Last sync {station.lastSyncAt ? formatDateTime(station.lastSyncAt) : 'Never'}
            </p>
            <p className="text-body-sm text-ink-muted">
              Queue {queueText(station)}, oldest retry {station.oldestRetryCount}
            </p>
            {revokeButton(station)}
          </div>
        )}
      />

      {creating && organizationId && (
        <CreateDialog
          organizationId={organizationId}
          onClose={() => setCreating(false)}
          onCreated={(credential) => {
            setCreating(false);
            setCreated(credential);
            void refresh();
          }}
        />
      )}

      {created && (
        <CredentialDialog
          created={created}
          onDone={() => {
            setCreated(null);
            setFocusCreateSignal((signal) => signal + 1);
          }}
        />
      )}

      {revoking && organizationId && (
        <RevokeDialog
          organizationId={organizationId}
          station={revoking}
          onClose={() => setRevoking(null)}
          onNotFound={() => void refresh()}
          onDone={() => {
            setRevoking(null);
            void refresh();
            showToast('Field Station credential revoked');
            setFocusHeadingSignal((signal) => signal + 1);
          }}
        />
      )}
    </section>
  );
};
