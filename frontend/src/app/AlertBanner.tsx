import React, { useEffect, useState } from 'react';
import { Siren, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { acknowledgeIncident } from '../features/acknowledge-incident/api';
import { ApiError } from '../shared/api/apiClient';
import { isLivePaused, subscribeLive } from '../shared/socket/socketClient';

// MSG32, shown from disconnect to `replay.done` (REQ-EVT-03).
const MSG32 = 'Reconnecting. Live data is paused.';
const MSG03 = 'Saved.';

// States in which an organization member can still acknowledge (incidents api-design 03).
const ACTIONABLE = /^(NOTIFY_|ESCALATED$|REPORTED$)/;

interface Alert {
  incidentId: string;
  text: string;
}

const alertFrom = (payload: Record<string, unknown>): Alert => {
  // A null holder label is left out rather than printed (MSG31, as the server's msg31 does).
  const holder =
    typeof payload.holderName === 'string' && payload.holderName ? payload.holderName : null;
  const time = new Date(String(payload.at)).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
  const text =
    typeof payload.message === 'string'
      ? payload.message
      : `SOS: ${String(payload.deviceLabel)}${holder ? ` (${holder})` : ''}, ${time}. Acknowledge now.`;
  return { incidentId: String(payload.incidentId), text };
};

const ACTION =
  'min-h-11 shrink-0 rounded-control bg-status-critical-on px-5 font-extrabold text-status-critical-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-status-critical-on disabled:opacity-60';

// On every page, above the header (REQ-EVT-01, design 8.9). Both banners are plain flow content, so a
// dialog can never sit over them. TrekLink Staff and Admin have no Acknowledge endpoint, so their
// banner opens the Staff queue instead (screen 8.2 Live data).
export const AlertBanner: React.FC<{ staff?: boolean }> = ({ staff = false }) => {
  const [paused, setPaused] = useState(isLivePaused());
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.kind === 'paused') setPaused(message.paused);
        if (message.kind !== 'entry') return;
        const { type, payload } = message.entry;
        if (type === 'incident.alert') {
          const alert = alertFrom(payload);
          setAlerts((current) => [
            alert,
            ...current.filter((a) => a.incidentId !== alert.incidentId),
          ]);
        }
        if (type === 'incident.changed' && !ACTIONABLE.test(String(payload.state))) {
          setAlerts((current) => current.filter((a) => a.incidentId !== payload.incidentId));
        }
      }),
    [],
  );

  const current = alerts[0];

  const acknowledge = async (alert: Alert) => {
    setPending(true);
    setFailure(null);
    try {
      await acknowledgeIncident(alert.incidentId);
      setNotice(MSG03);
      setAlerts((list) => list.filter((a) => a.incidentId !== alert.incidentId));
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === 'ALREADY_OWNED') {
        // MSG27: someone else took it, so the banner is done.
        setNotice(error.message);
        setAlerts((list) => list.filter((a) => a.incidentId !== alert.incidentId));
      } else {
        setFailure(error instanceof ApiError ? error.message : 'Could not acknowledge. Try again.');
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="sticky top-0 z-banner">
      {paused && (
        <div
          role="status"
          className="flex min-h-9 items-center justify-center gap-2 border-b border-status-attention-line bg-status-attention-tint px-4 py-1.5 text-center text-body-sm font-semibold text-status-attention-fg"
        >
          <WifiOff aria-hidden="true" className="h-4 w-4 shrink-0" />
          {MSG32}
        </div>
      )}
      {current && (
        <div role="alert" className="bg-status-critical-strong px-4 py-2 text-status-critical-on">
          <div className="mx-auto flex max-w-page flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 font-bold">
              <span
                aria-hidden="true"
                className="relative flex h-6 w-6 shrink-0 items-center justify-center"
              >
                <span className="absolute inset-0 rounded-full bg-status-critical-on/25 motion-safe:animate-ping" />
                <Siren className="relative h-4 w-4" />
              </span>
              <span>
                {current.text}
                {alerts.length > 1 && (
                  <span className="ml-2 text-body-sm font-semibold">
                    (+{alerts.length - 1} more)
                  </span>
                )}
              </span>
            </p>
            {staff ? (
              <Link to="/t/incidents" className={`${ACTION} inline-flex items-center`}>
                Open queue
              </Link>
            ) : (
              <button
                type="button"
                disabled={pending}
                onClick={() => void acknowledge(current)}
                className={ACTION}
              >
                {pending ? 'Acknowledging' : 'Acknowledge'}
              </button>
            )}
          </div>
          {failure && <p className="mx-auto mt-1 max-w-page text-body-sm">{failure}</p>}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-4 bg-inverse px-4 py-1 text-body-sm text-ink-inverse"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="min-h-11 px-3 font-semibold underline underline-offset-4"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
