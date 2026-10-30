import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../app/providers/useAuth';
import { organizationKeys, useOrganization } from '../../entities/organization/api';
import { rotateChannelKey } from '../../entities/organization/complianceCases';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime } from '../../shared/lib/format';
import { hasAnyRole } from '../../shared/lib/permissions';
import { Alert, Button, Dialog, Field, Skeleton, Textarea, useToast } from '../../shared/ui';
import { ErrorState, Fact } from '../../shared/ui/bits';
import { invalid, messageOf } from '../../shared/ui/errors';

const HEADING_ID = 'channel-key-title';
// MSG36 by code; the server's own text is not shown (D-059 rule 7).
const MSG36 = 'Someone else changed this. Reload to see the latest.';

interface Props {
  organization: { id: string; code: string; status: string };
}

const RotateDialog: React.FC<{
  organizationId: string;
  code: string;
  expectedVersion: number;
  onRotated: () => void;
  onReload: () => Promise<unknown>;
  onClose: () => void;
}> = ({ organizationId, code, expectedVersion, onRotated, onReload, onClose }) => {
  const [reason, setReason] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (reason.trim() === '') {
      setFieldError('Reason is required.');
      return;
    }
    setFieldError(null);
    setError(null);
    setStale(false);
    setPending(true);
    try {
      await rotateChannelKey(organizationId, reason.trim(), expectedVersion);
      onRotated();
    } catch (failure) {
      setPending(false);
      if (failure instanceof ApiError && failure.errorCode === 'STALE_VERSION') setStale(true);
      else if (failure instanceof ApiError && failure.errorCode === 'VALIDATION_FAILED') setFieldError(failure.message);
      else if (failure instanceof ApiError && failure.errorCode === 'NOT_FOUND') setError(failure.message);
      else setError(messageOf(failure));
    }
  };

  return (
    <Dialog
      titleId="rotate-key-title"
      title={`Record key rotation for ${code}?`}
      description="Record this after rotating the key with the counter's provisioning tool. Devices take the new version as they are re-provisioned at the counter."
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} loadingLabel="Recording" onClick={() => void submit()}>
            Record key rotation
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field id="rotate-key-reason" label="Reason" error={fieldError ?? undefined} required>
          <Textarea
            id="rotate-key-reason"
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            {...invalid('rotate-key-reason', fieldError ?? undefined)}
          />
        </Field>
        {stale && (
          <Alert
            tone="error"
            action={
              <Button
                size="sm"
                onClick={() => {
                  void onReload().then(() => setStale(false));
                }}
              >
                Reload
              </Button>
            }
          >
            {MSG36}
          </Alert>
        )}
        {error && <Alert tone="error">{error}</Alert>}
      </div>
    </Dialog>
  );
};

// The channel key of an ACTIVE or SUSPENDED organization in the /t/organizations panel (screen 3.6,
// organizations api-design 03 and 27; UC-60). TrekLink Staff record a rotation; Admin inherits Staff.
export const ChannelKeySection: React.FC<Props> = ({ organization }) => {
  const { user } = useAuth();
  const canRotate = hasAnyRole(user?.roles ?? [], ['STAFF']);
  const shown = organization.status === 'ACTIVE' || organization.status === 'SUSPENDED';
  const detail = useOrganization(shown ? organization.id : undefined);
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [rotating, setRotating] = useState(false);
  const [focusHeadingSignal, setFocusHeadingSignal] = useState(0);

  useEffect(() => {
    if (focusHeadingSignal === 0) return;
    document.getElementById(HEADING_ID)?.focus();
  }, [focusHeadingSignal]);

  if (!shown) return null;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.detail(organization.id) }),
    ]);

  return (
    <section aria-labelledby={HEADING_ID} className="flex flex-col gap-3 border-t border-line pt-4">
      <h3 id={HEADING_ID} tabIndex={-1} className="text-title-sm text-ink outline-none">
        Channel key
      </h3>
      {detail.isLoading && (
        <div role="status">
          <span className="sr-only">Loading the channel key</span>
          <Skeleton className="h-10" />
        </div>
      )}
      {detail.error && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />}
      {detail.data && (
        <>
          <dl>
            <Fact label="Version">{detail.data.channelKeyVersion}</Fact>
          </dl>
          {detail.data.channelKeyExposedAt && (
            <Alert tone="warning">
              Channel key exposed since {formatDateTime(detail.data.channelKeyExposedAt)}
            </Alert>
          )}
          {canRotate && (
            <Button className="w-full sm:w-auto sm:self-start" onClick={() => setRotating(true)}>
              Record key rotation
            </Button>
          )}
        </>
      )}
      {rotating && detail.data && (
        <RotateDialog
          organizationId={organization.id}
          code={organization.code}
          expectedVersion={detail.data.version}
          onClose={() => setRotating(false)}
          onReload={refresh}
          onRotated={() => {
            setRotating(false);
            void refresh();
            showToast('Channel key rotated');
            setFocusHeadingSignal((signal) => signal + 1);
          }}
        />
      )}
    </section>
  );
};
