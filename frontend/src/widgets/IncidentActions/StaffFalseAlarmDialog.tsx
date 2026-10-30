import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  declareFalseAlarm,
  fetchIncident,
  incidentKeys,
  type IncidentDetail,
} from '../../entities/incident/api';
import { ApiError } from '../../shared/api/apiClient';
import { Button } from '../../shared/ui/Button';
import { Dialog } from '../../shared/ui/Dialog';
import { Field, Textarea } from '../../shared/ui/Field';
import { messageOf } from '../../shared/ui/errors';
import { INCIDENT_STATE } from '../../shared/ui/status';
import { ALERT } from '../../shared/ui/styles';
import { useToast } from '../../shared/ui/toastStore';

// API 07: hold the version the person reviewed until an explicit Reload. A failed write never
// retries itself, and a live refetch cannot silently replace that version or the reason.
export const StaffFalseAlarmDialog: React.FC<{
  incident: IncidentDetail;
  onClose: () => void;
  onSaved: (code: string) => void;
  onUnavailable: () => void;
}> = ({ incident, onClose, onSaved, onUnavailable }) => {
  const client = useQueryClient();
  const [reviewed, setReviewed] = useState(incident);
  const [reason, setReason] = useState('');
  const [missing, setMissing] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);
  const [denied, setDenied] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const reasonField = useRef<HTMLTextAreaElement>(null);
  const keepEditing = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (discarding) keepEditing.current?.focus();
    else reasonField.current?.focus();
  }, [discarding, pending]);

  const currentState = incident.state !== 'UNROUTED' ? incident.state : reviewed.state;
  const stateChanged = currentState !== 'UNROUTED';
  const currentFailure = stateChanged
    ? `This cannot be done while it is ${INCIDENT_STATE[currentState].label}.`
    : failure;

  const close = () => {
    if (busy.current) return;
    if (reason.trim()) setDiscarding(true);
    else onClose();
  };

  const showFailure = (error: unknown) => {
    setFailure(messageOf(error));
    setNeedsReload(true);
    if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)) {
      setDenied(true);
      onUnavailable();
    }
  };

  const reload = async () => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      const latest = await fetchIncident(incident.id);
      client.setQueryData(incidentKeys.detail(incident.id), latest);
      setReviewed(latest);
      setNeedsReload(false);
      setFailure(
        latest.state === 'UNROUTED'
          ? null
          : `This cannot be done while it is ${INCIDENT_STATE[latest.state].label}.`,
      );
    } catch (error) {
      showFailure(error);
    } finally {
      busy.current = false;
      setPending(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy.current || needsReload || denied || stateChanged) return;
    if (!reason.trim()) {
      setMissing(true);
      return;
    }
    busy.current = true;
    setPending(true);
    setFailure(null);
    try {
      await declareFalseAlarm(reviewed.id, reviewed.version, reason.trim());
    } catch (error) {
      showFailure(error);
      busy.current = false;
      setPending(false);
      return;
    }
    // A committed write stays successful even if the refresh is offline. Do not offer to POST again.
    await Promise.all([
      client.invalidateQueries({ queryKey: incidentKeys.all }),
      client.invalidateQueries({ queryKey: incidentKeys.detail(reviewed.id) }),
    ]);
    useToast.getState().show('Saved.');
    onSaved(reviewed.code);
  };

  return (
    <Dialog
      titleId="staff-false-alarm-title"
      title={
        discarding
          ? 'Discard the reason?'
          : `Declare ${incident.code} on ${incident.device.assetTag ?? 'unknown device'} a false alarm?`
      }
      onClose={close}
    >
      {discarding ? (
        <div className="flex flex-col gap-4">
          <p>The unsaved reason will be discarded.</p>
          <Button ref={keepEditing} onClick={() => setDiscarding(false)}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={onClose}>
            Discard reason
          </Button>
        </div>
      ) : (
        <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          <p>Confirm that this incident is a false alarm. A new SOS may reopen it.</p>
          <Field
            id="staff-false-alarm-reason"
            label="Reason"
            required
            error={missing ? 'reason is required.' : undefined}
          >
            <Textarea
              ref={reasonField}
              id="staff-false-alarm-reason"
              value={reason}
              maxLength={2000}
              required
              aria-invalid={missing || undefined}
              aria-describedby={missing ? 'staff-false-alarm-reason-error' : undefined}
              readOnly={pending}
              onChange={(event) => {
                setReason(event.target.value);
                setMissing(false);
              }}
            />
          </Field>
          {currentFailure && (
            <p role="alert" className={ALERT}>
              {currentFailure}
            </p>
          )}
          {(needsReload || stateChanged) && !denied && (
            <Button onClick={() => void reload()} loading={pending}>
              Reload incident
            </Button>
          )}
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={close} disabled={pending}>
              Cancel
            </Button>
            {!denied && !stateChanged && (
              <Button type="submit" variant="danger" loading={pending} disabled={needsReload}>
                Declare false alarm
              </Button>
            )}
          </div>
        </form>
      )}
    </Dialog>
  );
};
