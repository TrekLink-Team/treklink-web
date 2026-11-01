import React, { useEffect, useState } from 'react';
import { Siren, WifiOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { fetchFleetIncidents, fetchIncidents, type Incident } from '../entities/incident/api';
import { acknowledgeIncident } from '../features/acknowledge-incident/api';
import { ApiError } from '../shared/api/apiClient';
import {
  LIVE_POLL_MS,
  isLivePaused,
  livePolls,
  subscribeLive,
} from '../shared/socket/socketClient';

// MSG32, shown from disconnect to `replay.done` (REQ-EVT-03).
const MSG32 = 'Reconnecting. Live data is paused.';
const MSG03 = 'Saved.';

// States in which an organization member can still acknowledge (incidents api-design 03).
const ACTIONABLE = /^(NOTIFY_|ESCALATED$|REPORTED$)/;

// TRANSITION: an SOS to acknowledge (MSG31). STALE: the device went silent (MSG40, incidents
// REQ-EVT-12), shown without Acknowledge. An alert sent before `kind` joined the payload is an SOS.
type AlertKind = 'TRANSITION' | 'STALE';

interface Alert {
  incidentId: string;
  kind: AlertKind;
  text: string;
}

// A device-silent alert stays until dismissed or until its incident has ended.
const ENDED = new Set(['RESOLVED', 'FALSE_ALARM', 'CLOSED']);

const same = (a: Alert, b: Pick<Alert, 'incidentId' | 'kind'>) =>
  a.incidentId === b.incidentId && a.kind === b.kind;

// Newest first, an SOS always ahead of a device-silent alert, so Acknowledge is never hidden behind one.
const ordered = (alerts: Alert[]): Alert[] =>
  alerts
    .filter((a) => a.kind === 'TRANSITION')
    .concat(alerts.filter((a) => a.kind === 'STALE'));

const alertFrom = (payload: Record<string, unknown>): Alert => {
  const kind: AlertKind = payload.kind === 'STALE' ? 'STALE' : 'TRANSITION';
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
  return { incidentId: String(payload.incidentId), kind, text };
};

// Poll mode (frontend design §3, D-089): no socket delivers `incident.alert`, so the banner reads, on
// each poll, the open incidents that wait for the viewer: for an organization member, its
// organization's incidents in a NOTIFY_ state that nobody has acknowledged; for TrekLink Staff, the
// unrouted and escalated ones of the Staff queue.
const SOURCE_TEXT: Record<Incident['source'], string> = {
  DEVICE_SOS: 'SOS',
  DEVICE_FALL: 'Fall detected',
  CADENCE_INFERRED: 'Possible emergency',
};
const polledAlerts = (items: readonly Incident[], staff: boolean): Alert[] =>
  items
    .filter((incident) =>
      staff
        ? incident.state === 'UNROUTED' || incident.state === 'ESCALATED'
        : /^NOTIFY_/.test(incident.state) && !incident.owner,
    )
    .map((incident) => {
      const holder = incident.device.holder?.name;
      const time = new Date(incident.firstEventAt).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      return {
        incidentId: incident.id,
        kind: 'TRANSITION' as const,
        text: `${SOURCE_TEXT[incident.source]}: ${incident.device.assetTag ?? 'Unknown device'}${
          holder ? ` (${holder})` : ''
        }, ${time}. Acknowledge now.`,
      };
    });

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
  // Poll mode: the incidents read on the last poll, and those this viewer has just handled, so an
  // acknowledged one does not flash back before the next poll.
  const [polled, setPolled] = useState<Alert[]>([]);
  const [handled, setHandled] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    if (!livePolls()) return;
    let stopped = false;
    const load = async () => {
      try {
        const page = staff
          ? await fetchFleetIncidents(['UNROUTED', 'ESCALATED'], 1)
          : await fetchIncidents({ open: true });
        if (!stopped) setPolled(polledAlerts(page.items, staff));
      } catch {
        // The next poll tries again; a failed read never clears a banner already shown.
      }
    };
    void load();
    const timer = setInterval(() => void load(), LIVE_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [staff]);

  useEffect(
    () =>
      subscribeLive((message) => {
        if (message.kind === 'paused') setPaused(message.paused);
        if (message.kind !== 'entry') return;
        const { type, payload } = message.entry;
        if (type === 'incident.alert') {
          const alert = alertFrom(payload);
          setAlerts((current) =>
            ordered([alert, ...current.filter((a) => !same(a, alert))]),
          );
        }
        if (type === 'incident.changed') {
          const state = String(payload.state);
          setAlerts((current) =>
            current.filter(
              (a) =>
                a.incidentId !== payload.incidentId ||
                (a.kind === 'TRANSITION' ? ACTIONABLE.test(state) : !ENDED.has(state)),
            ),
          );
        }
      }),
    [],
  );

  const shown = livePolls() ? polled.filter((alert) => !handled.has(alert.incidentId)) : alerts;
  const current = shown[0];
  // Only the SOS of that incident is done: a device-silent alert for it stays until dismissed.
  const done = (alert: Alert) => {
    setAlerts((list) => list.filter((a) => !same(a, alert)));
    setHandled((set) => new Set(set).add(alert.incidentId));
  };

  const acknowledge = async (alert: Alert) => {
    setPending(true);
    setFailure(null);
    try {
      await acknowledgeIncident(alert.incidentId);
      setNotice(MSG03);
      done(alert);
    } catch (error) {
      if (error instanceof ApiError && error.errorCode === 'ALREADY_OWNED') {
        // MSG27: someone else took it, so the banner is done.
        setNotice(error.message);
        done(alert);
      } else {
        setFailure(error instanceof ApiError ? error.message : 'Could not acknowledge. Try again.');
      }
    } finally {
      setPending(false);
    }
  };

  // A device-silent alert is dismissed by anyone who sees it, Staff included: an ESCALATED, UNROUTED
  // or REPORTED incident may stay open long after the device went silent.
  const dismissButton = (alert: Alert) => (
    <button
      type="button"
      onClick={() => setAlerts((list) => list.filter((a) => !same(a, alert)))}
      className={ACTION}
    >
      Dismiss
    </button>
  );

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
                {current.kind === 'TRANSITION' && (
                  <span className="absolute inset-0 rounded-full bg-status-critical-on/25 motion-safe:animate-ping" />
                )}
                <Siren className="relative h-4 w-4" />
              </span>
              <span>
                {current.text}
                {shown.length > 1 && (
                  <span className="ml-2 text-body-sm font-semibold">
                    (+{shown.length - 1} more)
                  </span>
                )}
              </span>
            </p>
            {staff ? (
              <div className="flex shrink-0 gap-2">
                {current.kind === 'STALE' && dismissButton(current)}
                <Link to="/t/incidents" className={`${ACTION} inline-flex items-center`}>
                  Open queue
                </Link>
              </div>
            ) : current.kind === 'STALE' ? (
              dismissButton(current)
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
