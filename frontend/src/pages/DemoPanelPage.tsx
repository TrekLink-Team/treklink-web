import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../shared/api/apiClient';
import type { StagedRecord } from '../entities/demo/api';
import {
  fetchPanel,
  panelKeys,
  panelPassword,
  PLAYBACK_FLOWS,
  resetDemoData,
  runPanelAction,
  sendPlayback,
  useDemoPanel,
  usePanelMutation,
  usePanelPassword,
  type PanelActionId,
  type PanelActionInput,
  type PanelActionView,
  type PanelGroup,
  type PanelOverview,
  type PlaybackCommand,
  type PlaybackFlow,
  type PlaybackState,
} from '../entities/demo/panel';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Dialog,
  Field,
  Input,
  Select,
  Skeleton,
  TabPanel,
  Tabs,
} from '../shared/ui';
import { PageScrollBody } from '../shared/ui/PageChrome';
import type { StatusTone } from '../shared/ui/status';

// /demo/panel (specs/demo/ui-panel.md, requirements §5, D-110): the panel a panel operator drives in a
// defence, with one shared password and no account. The presenter and the site clicker read their own
// views; only the operator view writes.

const WRONG = 'The panel password is wrong. Check it with the leader.';
const OFF = 'The demo panel is off on this deployment.';
const CONFIRMATION = 'RESET DEMO DATA';

type View = 'operator' | 'presenter' | 'clicker';

const PLAYBACK_TONE: Record<PlaybackState['status'], StatusTone> = {
  IDLE: 'ended',
  RUNNING: 'active',
  PAUSED: 'waiting',
  DONE: 'done',
  FAILED: 'critical',
  STOPPED: 'ended',
};
const STATUS_LABEL: Record<PlaybackState['status'], string> = {
  IDLE: 'Idle',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  DONE: 'Done',
  FAILED: 'Failed',
  STOPPED: 'Stopped',
};
// Actions that move a record one way: a Dialog naming the record first (ui-panel.md).
const CONFIRMED: PanelActionId[] = ['contract-cancel', 'incident-false-alarm', 'incident-close'];

const errorOf = (failure: unknown) =>
  failure instanceof Error ? failure.message : 'The request failed. Try again.';
const recordsOf = (failure: unknown): StagedRecord[] =>
  failure instanceof ApiError
    ? ((failure.resultDetails?.records as StagedRecord[] | undefined) ?? [])
    : [];

const RecordLinks: React.FC<{ records: StagedRecord[] }> = ({ records }) =>
  records.length === 0 ? null : (
    <ul className="mt-2 flex flex-col gap-1">
      {records.map((record) => (
        <li key={`${record.label}-${record.path}-${record.code}`} className="text-body">
          {record.label}:{' '}
          <Link to={record.path} className="font-semibold text-brand underline">
            {record.code}
          </Link>
        </li>
      ))}
    </ul>
  );

export const DemoPanelPage: React.FC = () => {
  const secret = usePanelPassword();
  const [gateError, setGateError] = useState<string | null>(null);
  if (!secret) return <PasswordGate error={gateError} onError={setGateError} />;
  return <PanelBody secret={secret} onLocked={setGateError} />;
};

const PasswordGate: React.FC<{ error: string | null; onError: (error: string | null) => void }> = ({
  error,
  onError,
}) => {
  const client = useQueryClient();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [off, setOff] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    onError(null);
    setNotice(null);
    setBusy(true);
    try {
      const overview = await fetchPanel(value);
      client.setQueryData(panelKeys.overview, overview);
      panelPassword.set(value);
    } catch (failure) {
      if (failure instanceof ApiError && failure.statusCode === 404) setOff(true);
      else if (failure instanceof ApiError && failure.statusCode === 401) onError(WRONG);
      else setNotice(errorOf(failure));
    } finally {
      setBusy(false);
      setValue('');
    }
  };

  return (
    <div data-fit-page="" className="flex min-h-0 flex-1 flex-col">
      <PageScrollBody label="Demo panel" className="flex flex-col items-center gap-4 py-4 sm:py-10">
        <Card className="w-full max-w-md">
          <h1 className="text-2xl font-bold text-ink">Demo panel</h1>
          {off ? (
            <div className="mt-3 flex flex-col gap-3">
              <Alert tone="info">{OFF}</Alert>
              <Link to="/demo" className="font-semibold text-brand underline">
                Back to demo sign-in
              </Link>
            </div>
          ) : (
            <form className="mt-3 flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
              {notice && <Alert tone="error">{notice}</Alert>}
              <Field
                id="panel-password"
                label="Panel password"
                hint="The password stays in this tab only. Closing or reloading the tab forgets it."
                error={error ?? undefined}
                required
              >
                <Input
                  id="panel-password"
                  type="password"
                  autoComplete="off"
                  value={value}
                  invalid={Boolean(error)}
                  onChange={(event) => setValue(event.target.value)}
                />
              </Field>
              <Button type="submit" variant="primary" size="lg" loading={busy} disabled={value === ''}>
                Open the panel
              </Button>
            </form>
          )}
        </Card>
      </PageScrollBody>
    </div>
  );
};

const PanelBody: React.FC<{ secret: string; onLocked: (error: string | null) => void }> = ({
  secret,
  onLocked,
}) => {
  const client = useQueryClient();
  const panel = useDemoPanel(secret);
  const [view, setView] = useState<View>('operator');
  const [announcement, setAnnouncement] = useState('');

  const lock = (error: string | null = null) => {
    panelPassword.clear();
    client.removeQueries({ queryKey: panelKeys.overview });
    onLocked(error);
  };

  // A 401 while open means the password was rotated: forget it and ask again.
  useEffect(() => {
    if (panel.error instanceof ApiError && panel.error.statusCode === 401) lock(WRONG);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.error]);

  if (panel.isPending) return <Skeleton className="m-4 h-40 w-full" />;
  if (!panel.data)
    return (
      <Alert tone="error" title="The demo panel could not be read.">
        {errorOf(panel.error)}
      </Alert>
    );
  const data = panel.data;
  const playback = data.playback;

  return (
    <div data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-2 py-2">
      <div className="flex items-center gap-3">
        <h1 className="text-title font-bold text-ink">Demo panel</h1>
        <Button className="ml-auto" size="sm" onClick={() => lock()}>
          Lock
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Badge tone={PLAYBACK_TONE[playback.status]}>
          {playback.flow ? `${playback.flow}: ` : 'Playback: '}
          {STATUS_LABEL[playback.status]}
        </Badge>
        <p
          role="status"
          aria-live="polite"
          aria-label="Panel status"
          className="min-w-0 text-body-sm text-ink-muted"
        >
          {announcement}
        </p>
      </div>
      {!data.writable && (
        <Alert tone="warning">
          This database is not a local, staging or demo database: every action will be refused.
        </Alert>
      )}
      <Tabs<View>
        label="Panel views"
        idPrefix="panel"
        value={view}
        onChange={setView}
        items={[
          { key: 'operator', label: 'Panel operator' },
          { key: 'presenter', label: 'Presenter' },
          { key: 'clicker', label: 'Site clicker' },
        ]}
      />
      <TabPanel idPrefix="panel" tabKey={view} className="min-h-0 flex-1 overflow-y-auto pb-4">
        {view === 'operator' && (
          <OperatorView data={data} announce={setAnnouncement} />
        )}
        {view === 'presenter' && <PresenterView playback={playback} />}
        {view === 'clicker' && <ClickerView playback={playback} />}
      </TabPanel>
    </div>
  );
};

// --- Panel operator -----------------------------------------------------------------------------------

const OperatorView: React.FC<{ data: PanelOverview; announce: (text: string) => void }> = ({
  data,
  announce,
}) => {
  const [result, setResult] = useState<{
    title: string;
    records: StagedRecord[];
    error: string | null;
  } | null>(null);
  const groups: PanelGroup[] = ['Incidents', 'Contracts', 'Billing', 'Devices'];

  return (
    <div className="flex flex-col gap-4 pt-3">
      <PlaybackCard playback={data.playback} announce={announce} />
      {result && (
        <Card aria-labelledby="panel-result">
          <h2 id="panel-result" className="text-body font-bold text-ink">
            {result.title}
          </h2>
          {result.error && (
            <Alert tone="error" className="mt-2">
              {result.error}
            </Alert>
          )}
          <RecordLinks records={result.records} />
        </Card>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {groups.map((group) => (
          <ActionGroup
            key={group}
            group={group}
            data={data}
            onResult={(next) => {
              setResult(next);
              announce(next.error ? `${next.title}: ${next.error}` : next.title);
            }}
          />
        ))}
      </div>
      <ResetCard reset={data.reset} announce={announce} />
    </div>
  );
};

const PlaybackCard: React.FC<{ playback: PlaybackState; announce: (text: string) => void }> = ({
  playback,
  announce,
}) => {
  const [flow, setFlow] = useState<PlaybackFlow>('MF-01a');
  const [interval, setIntervalSeconds] = useState('10');
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = usePanelMutation(sendPlayback);
  const live = playback.status === 'RUNNING' || playback.status === 'PAUSED';
  const waiting = playback.steps.find((step) => step.status === 'WAITING');
  const skipped = playback.steps.filter((step) => step.status === 'SKIPPED');

  const command = (name: PlaybackCommand) => {
    setError(null);
    setStopping(false);
    send.mutate(
      name === 'START' ? { command: name, flow, intervalSeconds: Number(interval) } : { command: name },
      {
        onSuccess: (state) =>
          announce(`Playback ${state.flow ?? ''} ${STATUS_LABEL[state.status].toLowerCase()}.`),
        onError: (failure) => setError(errorOf(failure)),
      },
    );
  };

  return (
    <Card aria-labelledby="panel-playback">
      <CardHeader title="Main flow playback" id="panel-playback" />
      {error && (
        <Alert tone="error" className="mb-3">
          {error}
        </Alert>
      )}
      {playback.error && (
        <Alert tone="error" className="mb-3">
          {playback.error}
        </Alert>
      )}
      <div className="grid grid-cols-2 items-end gap-3 sm:flex">
        <Field id="panel-flow" label="Main flow" className="sm:w-40">
          <Select
            id="panel-flow"
            value={live && playback.flow ? playback.flow : flow}
            disabled={live}
            onChange={(event) => setFlow(event.target.value as PlaybackFlow)}
          >
            {PLAYBACK_FLOWS.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="panel-interval" label="Seconds between steps" className="sm:w-48">
          <Input
            id="panel-interval"
            type="number"
            min={3}
            max={60}
            inputMode="numeric"
            value={interval}
            disabled={live}
            onChange={(event) => setIntervalSeconds(event.target.value)}
          />
        </Field>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" disabled={live || send.isPending} onClick={() => command('START')}>
          Start
        </Button>
        <Button disabled={playback.status !== 'RUNNING' || send.isPending} onClick={() => command('PAUSE')}>
          Pause
        </Button>
        <Button disabled={playback.status !== 'PAUSED' || send.isPending} onClick={() => command('RESUME')}>
          Resume
        </Button>
        <Button disabled={!live || send.isPending} onClick={() => command('STEP')}>
          Next step
        </Button>
        <Button variant="danger" disabled={!live || send.isPending} onClick={() => setStopping(true)}>
          Stop
        </Button>
      </div>
      {waiting?.prompt && (
        <Alert tone="warning" className="mt-3" title="Waiting for the real screen">
          {waiting.prompt}
        </Alert>
      )}
      {skipped.length > 0 && (
        <p className="mt-3 text-body-sm text-ink-muted">
          Skipped: {skipped.map((step) => step.title).join('; ')}
        </p>
      )}
      {playback.steps.length > 0 && (
        <p className="mt-3 text-body text-ink">
          {playback.status === 'DONE'
            ? `All ${playback.steps.length} steps finished${skipped.length ? `, ${skipped.length} skipped` : ''}.`
            : `Step ${Math.min(playback.index + 1, playback.steps.length)} of ${playback.steps.length}: ${
                playback.steps[Math.min(playback.index, playback.steps.length - 1)].title
              }`}
        </p>
      )}
      {stopping && (
        <Dialog
          titleId="panel-stop"
          title={`Stop the playback of ${playback.flow ?? 'the flow'}?`}
          description="The steps already run stay done. A stopped playback cannot resume."
          onClose={() => setStopping(false)}
          footer={
            <>
              <Button onClick={() => setStopping(false)}>Cancel</Button>
              <Button variant="danger" onClick={() => command('STOP')}>
                Stop
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </Card>
  );
};

// The badge of a step; a PENDING step reads Next or To do.
const STEP_LABEL: Partial<Record<PlaybackState['steps'][number]['status'], string>> = {
  RUNNING: 'Running',
  WAITING: 'Waiting',
  SKIPPED: 'Skipped',
  DONE: 'Done',
  FAILED: 'Failed',
};

const StepList: React.FC<{ playback: PlaybackState }> = ({ playback }) => (
  <ol className="mt-3 flex flex-col gap-2">
    {playback.steps.map((step, index) => {
      const current = index === playback.index && (playback.status === 'RUNNING' || playback.status === 'PAUSED');
      return (
        <li
          key={step.title}
          aria-current={current ? 'step' : undefined}
          className={`rounded-control border px-3 py-2 ${current ? 'border-brand bg-surface-raised' : 'border-line'}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body font-semibold text-ink">
              {index + 1}. {step.title}
            </span>
            <Badge
              tone={
                step.status === 'DONE'
                  ? 'done'
                  : step.status === 'FAILED'
                    ? 'critical'
                    : step.status === 'RUNNING' || step.status === 'WAITING'
                      ? 'active'
                      : step.status === 'SKIPPED'
                        ? 'ended'
                        : 'waiting'
              }
            >
              {STEP_LABEL[step.status] ?? (current ? 'Next' : 'To do')}
            </Badge>
          </div>
          <p className="mt-1 text-body text-ink">{step.line}</p>
          <p className="mt-1 text-body-sm text-ink-muted">
            {step.window}, {step.screen}
          </p>
          {step.prompt && <p className="mt-1 text-body font-semibold text-ink">{step.prompt}</p>}
          {step.error && <p className="mt-1 text-body-sm text-status-critical-fg">{step.error}</p>}
          <RecordLinks records={step.records} />
        </li>
      );
    })}
  </ol>
);

interface Choice {
  id: string;
  label: string;
  version?: number;
}

const choicesOf = (group: PanelGroup, data: PanelOverview): { label: string; choices: Choice[] } => {
  const { options } = data;
  switch (group) {
    case 'Incidents':
      return {
        label: 'Incident',
        choices: options.incidents.map((row) => ({
          id: row.id,
          label: `${row.code}, ${row.state.toLowerCase().replace(/_/g, ' ')}${row.simulated ? ', simulated' : ''}`,
          version: row.version,
        })),
      };
    case 'Contracts':
      return {
        label: 'Contract',
        choices: options.contracts.map((row) => ({
          id: row.id,
          label: `${row.code}, ${row.status.toLowerCase().replace(/_/g, ' ')}`,
          version: row.version,
        })),
      };
    case 'Billing':
      return {
        label: 'Invoice',
        choices: options.invoices.map((row) => ({
          id: row.id,
          label: `${row.number}, ${Number(row.dueVnd).toLocaleString('en-US')} VND due`,
        })),
      };
    case 'Devices':
      return {
        label: 'Device',
        choices: options.devices.map((row) => ({
          id: row.id,
          label: `${row.assetTag}, ${row.status.toLowerCase()}`,
          version: row.version,
        })),
      };
  }
};

const ActionGroup: React.FC<{
  group: PanelGroup;
  data: PanelOverview;
  onResult: (result: { title: string; records: StagedRecord[]; error: string | null }) => void;
}> = ({ group, data, onResult }) => {
  const { label, choices } = useMemo(() => choicesOf(group, data), [group, data]);
  const rented = useMemo(
    () => data.options.devices.filter((device) => device.status === 'RENTED'),
    [data.options.devices],
  );
  const [selected, setSelected] = useState('');
  const [unit, setUnit] = useState('');
  const [confirming, setConfirming] = useState<PanelActionView | null>(null);
  const run = usePanelMutation((secret: string, input: { action: PanelActionId; body: PanelActionInput }) =>
    runPanelAction(secret, input.action, input.body),
  );
  const actions = data.actions.filter((action) => action.group === group);
  const choice = choices.find((row) => row.id === selected);
  const idPrefix = `panel-${group.toLowerCase()}`;

  const bodyOf = (action: PanelActionView): PanelActionInput | null => {
    if (action.id === 'incident-sos') return unit ? { deviceId: unit } : null;
    if (action.needs.length === 0) return {};
    if (!choice) return null;
    if (group === 'Devices')
      return action.needs.includes('expectedVersion')
        ? { deviceId: choice.id, expectedVersion: choice.version }
        : { deviceId: choice.id };
    return action.needs.includes('expectedVersion')
      ? { recordId: choice.id, expectedVersion: choice.version }
      : { recordId: choice.id };
  };

  const execute = (action: PanelActionView) => {
    setConfirming(null);
    const body = bodyOf(action);
    if (!body) return;
    run.mutate(
      { action: action.id, body },
      {
        onSuccess: (result) =>
          onResult({
            title: `${action.label}: done${result.actedAs ? ` as ${result.actedAs.email ?? result.actedAs.role}` : ''}.`,
            records: result.records,
            error: null,
          }),
        onError: (failure) =>
          onResult({ title: `${action.label}: refused.`, records: recordsOf(failure), error: errorOf(failure) }),
      },
    );
  };

  return (
    <Card aria-labelledby={`${idPrefix}-title`}>
      <CardHeader title={group} id={`${idPrefix}-title`} />
      <div className="flex flex-col gap-3">
        <Field id={`${idPrefix}-record`} label={label}>
          <Select id={`${idPrefix}-record`} value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Choose {label.toLowerCase()}</option>
            {choices.map((row) => (
              <option key={row.id} value={row.id}>
                {row.label}
              </option>
            ))}
          </Select>
        </Field>
        {group === 'Incidents' && (
          <Field id={`${idPrefix}-unit`} label="Rented unit for an SOS">
            <Select id={`${idPrefix}-unit`} value={unit} onChange={(event) => setUnit(event.target.value)}>
              <option value="">Choose a rented unit</option>
              {rented.map((device) => (
                <option key={device.id} value={device.id}>
                  {device.assetTag}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              disabled={run.isPending || bodyOf(action) === null}
              loading={run.isPending && run.variables?.action === action.id}
              onClick={() => (CONFIRMED.includes(action.id) ? setConfirming(action) : execute(action))}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
      {confirming && (
        <Dialog
          titleId={`${idPrefix}-confirm`}
          title={`${confirming.label}: ${choice?.label ?? ''}?`}
          description="This moves the record through the real service and cannot be undone from the panel."
          onClose={() => setConfirming(null)}
          footer={
            <>
              <Button onClick={() => setConfirming(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => execute(confirming)}>
                {confirming.label}
              </Button>
            </>
          }
        >
          {null}
        </Dialog>
      )}
    </Card>
  );
};

const ResetCard: React.FC<{ reset: PanelOverview['reset']; announce: (text: string) => void }> = ({
  reset,
  announce,
}) => {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = usePanelMutation(resetDemoData);

  const submit = () => {
    setError(null);
    mutation.mutate(typed, {
      onSuccess: () => {
        setOpen(false);
        setTyped('');
        announce('Demo data reseeded. Every window must sign in again.');
      },
      onError: (failure) => setError(errorOf(failure)),
    });
  };

  return (
    <Card aria-labelledby="panel-reset">
      <CardHeader
        title="Reseed the demo database"
        id="panel-reset"
        description="Deletes every demo record and loads the standard demo seed. Only on the dedicated demo database."
      />
      {!reset.available && reset.reason && <Alert tone="info">{reset.reason}</Alert>}
      {error && !open && (
        <Alert tone="error" className="mt-2">
          {error}
        </Alert>
      )}
      <div className="mt-3">
        <Button variant="danger" disabled={!reset.available} onClick={() => setOpen(true)}>
          Reseed the demo database
        </Button>
      </div>
      {open && (
        <Dialog
          titleId="panel-reset-confirm"
          title="Reseed the demo database?"
          description="Every demo record is deleted and the standard demo seed is loaded. Every window must sign in again."
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                variant="danger"
                form="panel-reset-form"
                type="submit"
                loading={mutation.isPending}
                disabled={typed !== CONFIRMATION}
              >
                Reseed
              </Button>
            </>
          }
        >
          <form
            id="panel-reset-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (typed === CONFIRMATION) submit();
            }}
          >
            {error && (
              <Alert tone="error" className="mb-3">
                {error}
              </Alert>
            )}
            <Field id="panel-reset-typed" label={`Type ${CONFIRMATION} to confirm`}>
              <Input
                id="panel-reset-typed"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
              />
            </Field>
          </form>
        </Dialog>
      )}
    </Card>
  );
};

// --- Presenter and site clicker ----------------------------------------------------------------------

const NoPlayback: React.FC = () => (
  <p className="pt-3 text-body text-ink-muted">No playback has started. The panel operator starts one.</p>
);

const PresenterView: React.FC<{ playback: PlaybackState }> = ({ playback }) =>
  playback.steps.length === 0 ? (
    <NoPlayback />
  ) : (
    <section aria-labelledby="panel-presenter" className="pt-3">
      <h2 id="panel-presenter" className="text-title text-ink">
        {playback.flow}: {STATUS_LABEL[playback.status]}
      </h2>
      <StepList playback={playback} />
    </section>
  );

const ClickerView: React.FC<{ playback: PlaybackState }> = ({ playback }) => {
  if (playback.steps.length === 0) return <NoPlayback />;
  const current = playback.steps[Math.min(playback.index, playback.steps.length - 1)];
  const finished = playback.steps.filter(
    (step) => step.status === 'DONE' || step.status === 'SKIPPED',
  );
  const last = finished[finished.length - 1];
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Card aria-labelledby="panel-clicker-now">
        <h2 id="panel-clicker-now" className="text-title text-ink">
          {playback.status === 'DONE' ? 'Flow done' : `Next: ${current.title}`}
        </h2>
        {playback.status !== 'DONE' && (
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body">
            <dt className="font-semibold text-ink">Window</dt>
            <dd className="text-ink">{current.window}</dd>
            <dt className="font-semibold text-ink">Page</dt>
            <dd className="text-ink">{current.screen}</dd>
            <dt className="font-semibold text-ink">Click</dt>
            <dd className="text-ink">{current.click}</dd>
          </dl>
        )}
        {playback.status !== 'DONE' && current.prompt && (
          <Alert tone="warning" className="mt-3" title="The panel is waiting for you">
            {current.prompt}
          </Alert>
        )}
      </Card>
      {last && (
        <Card aria-labelledby="panel-clicker-last">
          <h2 id="panel-clicker-last" className="text-body font-bold text-ink">
            {last.status === 'SKIPPED' ? `Skipped: ${last.title}` : `Just done: ${last.title}`}
          </h2>
          <RecordLinks records={last.records} />
        </Card>
      )}
    </div>
  );
};
