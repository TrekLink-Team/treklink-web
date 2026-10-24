import React, { useEffect, useState } from 'react';
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
  const time = new Date(String(payload.at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const text =
    typeof payload.message === 'string'
      ? payload.message
      : `SOS: ${String(payload.deviceLabel)} (${String(payload.holderName)}), ${time}. Acknowledge now.`;
  return { incidentId: String(payload.incidentId), text };
};

// On every page, above the header (REQ-EVT-01, design 8.9). Both banners are plain flow content, so a
// dialog can never sit over them.
export const AlertBanner: React.FC = () => {
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
          setAlerts((current) => [alert, ...current.filter((a) => a.incidentId !== alert.incidentId)]);
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
    <div className="sticky top-0 z-[1000]">
      {paused && (
        <div role="status" className="bg-amber-100 px-4 py-2 text-center text-sm font-semibold text-amber-900">
          {MSG32}
        </div>
      )}
      {current && (
        <div role="alert" className="animate-pulse bg-red-600 px-4 py-3 text-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              {current.text}
              {alerts.length > 1 && <span className="ml-2 text-sm">(+{alerts.length - 1} more)</span>}
            </p>
            <button
              type="button"
              disabled={pending}
              onClick={() => void acknowledge(current)}
              className="min-h-11 rounded-lg bg-white px-5 font-semibold text-red-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60"
            >
              {pending ? 'Acknowledging' : 'Acknowledge'}
            </button>
          </div>
          {failure && <p className="mt-1 text-sm">{failure}</p>}
        </div>
      )}
      {notice && (
        <div
          role="status"
          className="flex items-center justify-between gap-4 bg-slate-900 px-4 py-2 text-sm text-white"
        >
          <span>{notice}</span>
          <button type="button" onClick={() => setNotice(null)} className="min-h-11 px-3 underline">
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
};
