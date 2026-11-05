import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  NO_STYLE_LABEL,
  PATTERN_LABEL,
  STYLE_LABEL,
  raiseSimulatedEvent,
  simulationKey,
  startSimulatedNode,
  stopSimulatedNode,
  updateSimulatedNode,
  type SimulatedNode,
  type SimulationOverview,
  type SimulationPattern,
  type SimulationStyle,
} from '../../entities/demo/simulation';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatUtc } from '../../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  Select,
  useToast,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

const NOT_ALLOWED = 'The field simulation runs only on a local database or the Vercel staging.';

// Screen 7.5 shows the server's message for every refusal of demo 07 to 10 (DEMO_DATABASE_NOT_ALLOWED,
// DEMO_NODE_RUNNING, INVALID_STATE_TRANSITION, STALE_VERSION, VALIDATION_FAILED, NOT_FOUND).
const simulationMessageOf = (error: unknown): string =>
  error instanceof ApiError && error.errorCode !== '' ? error.message : messageOf(error);

const sosText = (node: SimulatedNode): string => {
  if (!node.sosKind || !node.sosSince) return 'None';
  const time = new Date(node.sosSince).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${node.sosKind === 'FALL' ? 'Fall' : 'SOS'} since ${time}`;
};

const minutesAgo = (iso: string): string => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return minutes === 0 ? 'just now' : `${minutes} min ago`;
};

type Confirming = { kind: 'SOS' | 'FALL' | 'STOP'; node: SimulatedNode } | { kind: 'QUICK_SOS' };

type Quick = 'sos' | 'silent' | 'stray';

const confirmTitle = (confirming: Confirming): string => {
  if (confirming.kind === 'QUICK_SOS') return 'Send an SOS from a rented node?';
  const tag = confirming.node.assetTag ?? confirming.node.nodeId;
  if (confirming.kind === 'STOP') return `Stop ${tag}?`;
  return `Send ${confirming.kind === 'FALL' ? 'a fall SOS' : 'an SOS'} from ${tag}?`;
};

interface Props {
  simulation: SimulationOverview;
}

// Section "Field simulation" of screen 7.5 (specs/frontend/ui-design/7-5-demo-control-panel.md; specs/demo
// requirements §2.4, design §9): start simulated nodes on OpenStreetMap trails, change their pattern,
// raise an SOS or a fall, cancel it and stop them, from the browser alone (AC-08).
export const FieldSimulationSection: React.FC<Props> = ({ simulation }) => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const [patterns, setPatterns] = useState<Record<string, SimulationPattern>>({});
  const firstFree = simulation.devices.find((d) => d.runningNodeId === null);
  const [deviceId, setDeviceId] = useState(firstFree?.id ?? '');
  const [trailId, setTrailId] = useState(simulation.trails[0]?.id ?? '');
  const [pattern, setPattern] = useState<SimulationPattern>('WALK');
  // '' leaves the style to the asset tag (demo design §9.1).
  const [style, setStyle] = useState<SimulationStyle | ''>('');
  const [styles, setStyles] = useState<Record<string, SimulationStyle>>({});

  const allowed = simulation.databaseAllowed;
  const trailName = (id: string) => simulation.trails.find((t) => t.id === id)?.name ?? id;
  const running = simulation.nodes.filter((n) => n.status === 'RUNNING');
  const rentedIds = new Set(
    simulation.devices.filter((d) => d.status === 'RENTED').map((d) => d.id),
  );

  const act = async (key: string, work: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await work();
    } catch (failure) {
      setError(simulationMessageOf(failure));
    } finally {
      setBusy(null);
      await queryClient.invalidateQueries({ queryKey: simulationKey });
    }
  };

  const addNode = (event: React.FormEvent) => {
    event.preventDefault();
    void act('add', async () => {
      const node = await startSimulatedNode({
        deviceId,
        trailId,
        pattern,
        ...(style === '' ? {} : { style }),
      });
      showToast(
        `${node.assetTag ?? 'The device'} runs on ${trailName(node.trailId)}${
          node.style ? ` as ${STYLE_LABEL[node.style]}` : ''
        }.`,
      );
    });
  };

  const applyPattern = (node: SimulatedNode) =>
    act(node.id, async () => {
      const next = patterns[node.id] ?? node.pattern;
      await updateSimulatedNode(node, { pattern: next });
      showToast(`${node.assetTag} now ${PATTERN_LABEL[next]}.`);
    });

  const applyStyle = (node: SimulatedNode) =>
    act(node.id, async () => {
      const next = styles[node.id];
      if (!next) return;
      await updateSimulatedNode(node, { style: next });
      showToast(`${node.assetTag} now moves as ${STYLE_LABEL[next]}.`);
    });

  const raise = (node: SimulatedNode, kind: 'SOS' | 'FALL' | 'SOS_CANCEL') =>
    act(node.id, async () => {
      await raiseSimulatedEvent(node, kind);
      showToast(
        kind === 'SOS_CANCEL'
          ? 'Beacons stopped. Resolve the incident as for a real device.'
          : `${kind === 'FALL' ? 'Fall SOS' : 'SOS'} sent from ${node.assetTag}.`,
      );
    });

  const stop = (node: SimulatedNode) =>
    act(node.id, async () => {
      await stopSimulatedNode(node);
      showToast(`${node.assetTag} stopped.`);
    });

  // The quick buttons of the demo script: the first running node on a rented device, or a new WALK node
  // on the first rented device without one.
  const quickNode = async (): Promise<SimulatedNode> => {
    const existing =
      running.find((n) => rentedIds.has(n.deviceId)) ??
      (running.length > 0 ? running[0] : undefined);
    if (existing) return existing;
    const device =
      simulation.devices.find((d) => d.status === 'RENTED' && d.runningNodeId === null) ??
      simulation.devices.find((d) => d.runningNodeId === null);
    if (!device || !simulation.trails[0]) throw new Error('No device can be simulated.');
    return startSimulatedNode({
      deviceId: device.id,
      trailId: simulation.trails[0].id,
      pattern: 'WALK',
    });
  };

  const quick = (which: Quick) =>
    act(`quick-${which}`, async () => {
      const node = await quickNode();
      if (which === 'sos') {
        await raiseSimulatedEvent(node, 'SOS');
        showToast(`SOS sent from ${node.assetTag}.`);
      } else if (which === 'silent') {
        await updateSimulatedNode(node, { pattern: 'SILENT' });
        showToast(`${node.assetTag} is silent; it turns stale after the threshold.`);
      } else {
        await updateSimulatedNode(node, { pattern: 'STRAY' });
        showToast(`${node.assetTag} leaves the trail.`);
      }
    });

  const confirm = () => {
    if (!confirming) return;
    setConfirming(null);
    if (confirming.kind === 'QUICK_SOS') void quick('sos');
    else if (confirming.kind === 'STOP') void stop(confirming.node);
    else void raise(confirming.node, confirming.kind);
  };

  const disabled = !allowed || busy !== null;

  return (
    <section aria-labelledby="field-simulation" className="flex flex-col gap-3">
      <h2 id="field-simulation" className="text-title text-ink">
        Field simulation
      </h2>
      <p className="text-body-sm text-ink-muted">
        Simulated nodes send positions, telemetry and SOS packets through the normal ingestion path.
        Everything they cause is labelled Simulated.
      </p>
      {!allowed && (
        <Alert tone="warning" title={NOT_ALLOWED}>
          Every simulation action is disabled.
        </Alert>
      )}
      {error && (
        <Alert tone="error" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      )}

      <Card aria-labelledby="simulation-quick">
        <CardHeader
          title="Demo cases"
          id="simulation-quick"
          description="One click for each field case of the demo script."
        />
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            variant="danger"
            size="sm"
            disabled={disabled}
            loading={busy === 'quick-sos'}
            onClick={() => setConfirming({ kind: 'QUICK_SOS' })}
          >
            SOS on a rented node
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            loading={busy === 'quick-silent'}
            onClick={() => void quick('silent')}
          >
            A node goes silent
          </Button>
          <Button
            size="sm"
            disabled={disabled}
            loading={busy === 'quick-stray'}
            onClick={() => void quick('stray')}
          >
            A node strays
          </Button>
        </div>
      </Card>

      <Card aria-labelledby="simulation-nodes">
        <CardHeader title="Simulated nodes" id="simulation-nodes" />
        {simulation.nodes.length === 0 ? (
          <EmptyState title="No simulated nodes. Add one below." className="mt-3" />
        ) : (
          <div
            // The table scrolls inside its box below its width (UI standard 1.4.10); the box takes focus so
            // a keyboard user can scroll it.
            role="region"
            aria-label="Simulated nodes table"
            tabIndex={0}
            className="mt-3 overflow-x-auto focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
          >
            <table className="w-full min-w-[60rem] text-left text-body-sm">
              <caption className="sr-only">Simulated nodes, running first</caption>
              <thead className="border-b border-line text-ink-muted">
                <tr>
                  {[
                    'Device',
                    'Organization',
                    'Trail',
                    'Pattern and style',
                    'Position',
                    'Battery',
                    'Last packet',
                    'SOS',
                    'Actions',
                  ].map((header) => (
                    <th key={header} scope="col" className="px-2 py-2 font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {simulation.nodes.map((node) => {
                  const rowBusy = busy === node.id;
                  const isRunning = node.status === 'RUNNING';
                  // The row's name: each action's accessible name carries it, so a screen reader user
                  // hears which node a button acts on (WCAG 2.4.6), and the visible text stays first in it
                  // (WCAG 2.5.3).
                  const label = node.assetTag ?? node.nodeId;
                  return (
                    <tr
                      key={node.id}
                      className="border-b border-line align-top"
                      aria-busy={rowBusy || undefined}
                    >
                      <th scope="row" className="px-2 py-2 font-normal">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <span className="font-semibold text-ink">{label}</span>
                          <Badge>Simulated</Badge>
                          {!isRunning && <Badge tone="ended">Stopped</Badge>}
                        </span>
                      </th>
                      <td className="px-2 py-2 text-ink">
                        {node.organization?.code ?? 'TrekLink'}
                      </td>
                      <td className="px-2 py-2 text-ink">{trailName(node.trailId)}</td>
                      <td className="px-2 py-2">
                        {/* Pattern and style share a cell, so the row actions stay in view. */}
                        <span className="flex flex-col gap-1.5">
                          {isRunning ? (
                            <span className="flex items-center gap-1.5">
                              <Select
                                aria-label={`Pattern for ${label}`}
                                // Wide enough for the longest label, "Stray off the trail".
                                className="min-w-[10rem]"
                                value={patterns[node.id] ?? node.pattern}
                                disabled={disabled}
                                onChange={(e) =>
                                  setPatterns({
                                    ...patterns,
                                    [node.id]: e.target.value as SimulationPattern,
                                  })
                                }
                              >
                                {simulation.patterns.map((p) => (
                                  <option key={p} value={p}>
                                    {PATTERN_LABEL[p]}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                size="sm"
                                disabled={
                                  disabled || (patterns[node.id] ?? node.pattern) === node.pattern
                                }
                                onClick={() => void applyPattern(node)}
                                aria-label={`Apply pattern to ${label}`}
                              >
                                Apply
                              </Button>
                            </span>
                          ) : (
                            <span className="text-ink">{PATTERN_LABEL[node.pattern]}</span>
                          )}
                          {isRunning ? (
                            <span className="flex items-center gap-1.5">
                              <Select
                                aria-label={`Style for ${label}`}
                                // Wide enough for the longest label, "Group follower".
                                className="min-w-[10rem]"
                                value={styles[node.id] ?? node.style ?? ''}
                                disabled={disabled}
                                onChange={(e) =>
                                  setStyles({
                                    ...styles,
                                    [node.id]: e.target.value as SimulationStyle,
                                  })
                                }
                              >
                                {node.style === null && (
                                  <option value="" disabled>
                                    {NO_STYLE_LABEL}
                                  </option>
                                )}
                                {simulation.styles.map((option) => (
                                  <option key={option} value={option}>
                                    {STYLE_LABEL[option]}
                                  </option>
                                ))}
                              </Select>
                              <Button
                                size="sm"
                                disabled={
                                  disabled ||
                                  styles[node.id] === undefined ||
                                  styles[node.id] === node.style
                                }
                                onClick={() => void applyStyle(node)}
                                aria-label={`Apply style to ${label}`}
                              >
                                Apply
                              </Button>
                            </span>
                          ) : (
                            <span className="text-ink">
                              {node.style ? STYLE_LABEL[node.style] : NO_STYLE_LABEL}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="px-2 py-2 font-mono text-ink">
                        {node.position.lat.toFixed(6)}, {node.position.lon.toFixed(6)}
                      </td>
                      <td className="px-2 py-2 text-ink">{node.batteryPct}%</td>
                      <td className="px-2 py-2 text-ink">
                        {node.lastPacketAt ? (
                          <time
                            dateTime={node.lastPacketAt}
                            title={`${formatDateTime(node.lastPacketAt)}, ${formatUtc(node.lastPacketAt)}`}
                          >
                            {minutesAgo(node.lastPacketAt)}
                          </time>
                        ) : (
                          'Never'
                        )}
                      </td>
                      <td className="px-2 py-2 text-ink">{sosText(node)}</td>
                      <td className="px-2 py-2">
                        {isRunning && (
                          <span className="flex flex-wrap gap-1.5">
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={disabled}
                              onClick={() => setConfirming({ kind: 'SOS', node })}
                              aria-label={`SOS on ${label}`}
                            >
                              SOS
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              disabled={disabled}
                              onClick={() => setConfirming({ kind: 'FALL', node })}
                              aria-label={`Fall on ${label}`}
                            >
                              Fall
                            </Button>
                            {node.sosKind && (
                              <Button
                                size="sm"
                                disabled={disabled}
                                onClick={() => void raise(node, 'SOS_CANCEL')}
                                aria-label={`Cancel SOS on ${label}`}
                              >
                                Cancel SOS
                              </Button>
                            )}
                            <Button
                              size="sm"
                              disabled={disabled}
                              onClick={() => setConfirming({ kind: 'STOP', node })}
                              aria-label={`Stop ${label}`}
                            >
                              Stop
                            </Button>
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <details className="mt-3 text-body-sm text-ink-muted">
          <summary className="cursor-pointer">Trails © OpenStreetMap contributors, ODbL.</summary>
          <ul className="mt-1 flex flex-col gap-0.5">
            {simulation.trails.map((trail) => (
              <li key={trail.id}>
                {trail.name} ({trail.region}): OpenStreetMap way {trail.source.osmWayIds.join(', ')}
                , read {trail.source.readOn}, {trail.source.simplification}.
              </li>
            ))}
          </ul>
        </details>
      </Card>

      <Card aria-labelledby="simulation-add">
        <CardHeader title="Add node" id="simulation-add" />
        <form
          onSubmit={addNode}
          className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end"
        >
          <Field id="simulation-device" label="Device">
            <Select
              id="simulation-device"
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              disabled={!allowed}
            >
              {simulation.devices.map((device) => (
                <option key={device.id} value={device.id} disabled={device.runningNodeId !== null}>
                  {device.assetTag}, {device.status}
                  {device.organization ? `, ${device.organization.code}` : ''}
                  {device.runningNodeId !== null ? ' (running)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field id="simulation-trail" label="Trail">
            <Select
              id="simulation-trail"
              value={trailId}
              onChange={(e) => setTrailId(e.target.value)}
              disabled={!allowed}
            >
              {simulation.trails.map((trail) => (
                <option key={trail.id} value={trail.id}>
                  {trail.name}, {trail.region}, {(trail.lengthMetres / 1000).toFixed(1)} km
                </option>
              ))}
            </Select>
          </Field>
          <Field id="simulation-pattern" label="Pattern">
            <Select
              id="simulation-pattern"
              value={pattern}
              onChange={(e) => setPattern(e.target.value as SimulationPattern)}
              disabled={!allowed}
            >
              {simulation.patterns.map((p) => (
                <option key={p} value={p}>
                  {PATTERN_LABEL[p]}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            id="simulation-style"
            label="Movement style"
            hint="A style sets its own pace, rests and path while the pattern walks."
          >
            <Select
              id="simulation-style"
              value={style}
              onChange={(e) => setStyle(e.target.value as SimulationStyle | '')}
              disabled={!allowed}
            >
              <option value="">From the asset tag</option>
              {simulation.styles.map((option) => (
                <option key={option} value={option}>
                  {STYLE_LABEL[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Button
            type="submit"
            variant="primary"
            disabled={disabled || deviceId === '' || trailId === ''}
            loading={busy === 'add'}
          >
            Add node
          </Button>
        </form>
      </Card>

      {confirming && (
        <ConfirmDialog
          titleId="simulation-confirm"
          title={confirmTitle(confirming)}
          description={
            confirming.kind === 'STOP'
              ? 'It sends nothing more and turns stale after the staleness threshold.'
              : 'It opens a real incident, marked Simulated, and alerts the on-duty operator.'
          }
          confirmLabel={
            confirming.kind === 'STOP'
              ? 'Stop node'
              : confirming.kind === 'FALL'
                ? 'Send fall SOS'
                : 'Send SOS'
          }
          destructive={confirming.kind !== 'STOP'}
          onConfirm={confirm}
          onCancel={() => setConfirming(null)}
        />
      )}
    </section>
  );
};
