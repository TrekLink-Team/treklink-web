import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import { apiKeyKeys, isActiveKey, useApiKeys, type ApiKey } from '../entities/api-key/api';
import {
  createApiKey,
  nameError,
  NAME_MAX_LENGTH,
  revokeApiKey,
  type CreatedApiKey,
} from '../features/manage-api-keys/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  ConfirmDialog,
  DataTable,
  Dialog,
  Field,
  Input,
  PageHeader,
  useToast,
  type Column,
} from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { ErrorState } from '../shared/ui/bits';

// Screen 3.4 says to show the server's message for these codes: KEY_LIMIT has no SRS message code
// (D-059 rule 3), and a key that is gone answers "API key not found.".
const serverMessage = (error: unknown): string =>
  error instanceof ApiError && (error.errorCode === 'KEY_LIMIT' || error.errorCode === 'NOT_FOUND')
    ? error.message
    : messageOf(error);

const isNotFound = (error: unknown) => error instanceof ApiError && error.errorCode === 'NOT_FOUND';

const StatusOf: React.FC<{ apiKey: ApiKey }> = ({ apiKey }) =>
  apiKey.revokedAt ? (
    <Badge tone="ended">Revoked {formatDateTime(apiKey.revokedAt)}</Badge>
  ) : (
    <Badge tone="active">Active</Badge>
  );

const lastUsed = (apiKey: ApiKey) => (apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt) : 'Never');

// The create form of organizations api-design 21: one step, one field.
const CreateDialog: React.FC<{
  organizationId: string;
  onCreated: (created: CreatedApiKey) => void;
  onClose: () => void;
}> = ({ organizationId, onCreated, onClose }) => {
  const [name, setName] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const error = nameError(name);
    setFieldError(error);
    setFailure(null);
    if (error) return;
    setPending(true);
    try {
      onCreated(await createApiKey(organizationId, name.trim()));
    } catch (caught) {
      setPending(false);
      if (caught instanceof ApiError && caught.errorCode === 'VALIDATION_FAILED') setFieldError(caught.message);
      else setFailure(serverMessage(caught));
    }
  };

  return (
    <Dialog
      titleId="create-api-key-title"
      title="Create API key"
      description="The key reads your organization's devices and telemetry, nothing else."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={() => void submit()}>
            Create key
          </Button>
        </>
      }
    >
      <form onSubmit={(event) => void submit(event)} noValidate className="flex flex-col gap-4">
        {failure && <Alert tone="error">{failure}</Alert>}
        <Field
          id="api-key-name"
          label="Name"
          hint="A label to tell your keys apart."
          error={fieldError ?? undefined}
          required
        >
          <Input
            id="api-key-name"
            value={name}
            maxLength={NAME_MAX_LENGTH}
            autoComplete="off"
            onChange={(event) => setName(event.target.value)}
            {...invalid('api-key-name', fieldError ?? undefined)}
          />
        </Field>
      </form>
    </Dialog>
  );
};

// The only place the full key ever appears. Done discards it; nothing else keeps it.
const KeyDialog: React.FC<{ created: CreatedApiKey; onDone: () => void }> = ({ created, onDone }) => {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(created.key);
      setCopyFailed(false);
      setCopied(true);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <Dialog
      titleId="new-api-key-title"
      title={`API key ${created.name} created`}
      description="Copy it now; it will not be shown again."
      onClose={onDone}
      footer={
        <Button variant="primary" onClick={onDone}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <Button icon={<Copy aria-hidden="true" className="h-4 w-4" />} onClick={() => void copy()} className="self-start">
          {copied ? 'Copied' : 'Copy'}
        </Button>
        <code
          aria-label="New API key"
          className="block select-all break-all rounded-control border border-line-strong bg-sunken px-3 py-2.5 font-mono text-body text-ink"
        >
          {created.key}
        </code>
        <p role="status" className="text-body-sm text-ink-muted">
          {copied ? 'The key is on your clipboard.' : ''}
        </p>
        {copyFailed && (
          <Alert tone="warning">The browser blocked the clipboard. Select the key above and copy it yourself.</Alert>
        )}
      </div>
    </Dialog>
  );
};

// /o/api-keys, screen 3.4 (organizations api-design 20 to 22; UC-06, FR-ORG-06): the Org Manager
// lists, creates and revokes the organization's read-only API keys. The list shows "n of limit" and
// Create is disabled at the limit; 409 KEY_LIMIT stays the server's guard (ruling 2026-10-30).
export const ApiKeysPage: React.FC = () => {
  const { user } = useAuth();
  const organizationId = user?.organization?.id;
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const keys = useApiKeys(organizationId);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedApiKey | null>(null);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const [revokePending, setRevokePending] = useState(false);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokedOne, setRevokedOne] = useState(0);

  // After a revoke the row loses its button, so focus moves to the page heading (screen 3.4).
  useEffect(() => {
    if (revokedOne > 0) document.getElementById('api-keys-title')?.focus();
  }, [revokedOne]);

  const refresh = () =>
    organizationId ? queryClient.invalidateQueries({ queryKey: apiKeyKeys.list(organizationId) }) : Promise.resolve();

  const items = keys.data?.items ?? [];
  const active = items.filter(isActiveKey).length;
  const revoked = items.length - active;
  const limit = keys.data?.limit;
  const atLimit = limit !== undefined && active >= limit;

  const revoke = async () => {
    if (!organizationId || !revoking) return;
    setRevokePending(true);
    setRevokeError(null);
    try {
      await revokeApiKey(organizationId, revoking.id);
      setRevoking(null);
      setRevokedOne((count) => count + 1);
      showToast('API key revoked');
      void refresh();
    } catch (caught) {
      setRevokeError(serverMessage(caught));
      if (isNotFound(caught)) void refresh();
    } finally {
      setRevokePending(false);
    }
  };

  const createButton = (
    <Button
      variant="primary"
      icon={<KeyRound aria-hidden="true" className="h-4 w-4" />}
      disabled={!keys.data || atLimit}
      onClick={() => setCreating(true)}
    >
      Create API key
    </Button>
  );

  const revokeButton = (apiKey: ApiKey) =>
    isActiveKey(apiKey) ? (
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11"
        aria-label={`Revoke ${apiKey.name}`}
        onClick={() => {
          setRevokeError(null);
          setRevoking(apiKey);
        }}
      >
        Revoke
      </Button>
    ) : null;

  const columns: Column<ApiKey>[] = [
    { key: 'name', header: 'Name', cell: (row) => <span className="font-semibold">{row.name}</span>, truncate: (row) => row.name },
    { key: 'prefix', header: 'Prefix', cell: (row) => <code className="font-mono text-body-sm">{row.prefix}</code>, width: '8rem' },
    { key: 'created', header: 'Created', cell: (row) => formatDateTime(row.createdAt) },
    { key: 'lastUsed', header: 'Last used', cell: lastUsed },
    { key: 'status', header: 'Status', cell: (row) => <StatusOf apiKey={row} /> },
  ];

  const countLine =
    limit === undefined
      ? undefined
      : `${active} of ${limit} active keys${revoked > 0 ? `, ${revoked} revoked` : ''}`;

  return (
    <section aria-labelledby="api-keys-title">
      <PageHeader
        id="api-keys-title"
        title="API keys"
        meta={countLine}
        description="Read-only keys your own systems use to read your devices' telemetry. A key is shown once, when it is created."
        primaryAction={createButton}
      />

      {atLimit && (
        <Alert tone="info" className="mb-4">
          Your organization holds the most active keys it may. Revoke an unused key before creating another.
        </Alert>
      )}

      <DataTable<ApiKey>
        caption="API keys"
        columns={columns}
        rows={keys.data?.items}
        rowId={(row) => row.id}
        loading={keys.isLoading}
        error={keys.error ? <ErrorState error={keys.error} onRetry={() => void keys.refetch()} /> : undefined}
        empty={{
          title: 'No API keys yet',
          description: "Create a key to read your devices' telemetry from your own systems.",
          icon: <KeyRound />,
        }}
        rowActions={revokeButton}
        renderCard={(row) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-ink">{row.name}</span>
              <StatusOf apiKey={row} />
            </div>
            <code className="font-mono text-body-sm text-ink-muted">{row.prefix}</code>
            <span className="text-body-sm text-ink-muted">Last used: {lastUsed(row)}</span>
            {revokeButton(row) && <div>{revokeButton(row)}</div>}
          </div>
        )}
      />

      {creating && organizationId && (
        <CreateDialog
          organizationId={organizationId}
          onClose={() => setCreating(false)}
          onCreated={(key) => {
            setCreating(false);
            setCreated(key);
            void refresh();
          }}
        />
      )}
      {created && <KeyDialog created={created} onDone={() => setCreated(null)} />}
      {revoking && (
        <ConfirmDialog
          titleId="revoke-api-key-title"
          title={`Revoke API key ${revoking.name}?`}
          description={`The key ${revoking.prefix} stops working from the next request. This cannot be undone.`}
          confirmLabel="Revoke key"
          destructive
          pending={revokePending}
          error={revokeError ?? undefined}
          onConfirm={() => void revoke()}
          onCancel={() => setRevoking(null)}
        />
      )}
    </section>
  );
};
