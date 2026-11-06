import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  BatteryMedium,
  Box,
  ClipboardCheck,
  Cpu,
  Handshake,
  History as HistoryIcon,
  IdCard,
  Plug,
  Power,
  RadioTower,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Siren,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { deviceKeys, fetchDevice, useDeviceHistoryFeed, type DeviceHistoryItem } from '../../../entities/device/api';
import { compareFirmware, latestReleaseFor, useFirmwareReleases } from '../../../entities/firmware/api';
import { useSession } from '../../../entities/session/model';
import { formatDateTime } from '../../../shared/lib/format';
import type { DockTimings } from '../../../shared/lib/meshtastic-dock';
import { hasAnyRole } from '../../../shared/lib/permissions';
import { useMediaQuery } from '../../../shared/lib/useMediaQuery';
import { Alert } from '../../../shared/ui/Alert';
import { Badge, StatusBadge } from '../../../shared/ui/Badge';
import { Button, IconButton } from '../../../shared/ui/Button';
import { Card } from '../../../shared/ui/Card';
import { Dialog } from '../../../shared/ui/Dialog';
import { PageScrollBody } from '../../../shared/ui/PageChrome';
import { cn } from '../../../shared/ui/cn';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import { useToast } from '../../../shared/ui/toastStore';
import { ConfigureUplinkDialog } from '../actions/ConfigureUplinkDialog';
import { factoryResetMessage, rebootMessage } from '../actions/messages';
import { useDocking } from '../actions/useDocking';
import type { Connection, ConnectionState } from '../model/ConnectorRegistry';
import { useConnectorStore, type FlashPanel, type FlashPanelProps } from '../model/connectorStore';
import { HUB_GROUPS, HUB_LABELS, hubActionsFor, type HubAction, type HubConfirm } from '../model/hubActions';
import { STATE_TEXT, unitName } from '../model/text';
import { useConnector, useConnectorRefresh } from '../model/useConnector';
import { useFlashAvailability } from '../model/useFlashAvailability';
import { HubActionDialog } from './HubActionDialog';
import { UnitImage } from './UnitImage';

// The device hub page (devices design sections 12.13 and 12.14, screen 4.7, REQ-EVT-44): one connected unit at a
// time. A header with the render, asset tag, status, variant and firmware; field groups with icons; the device's
// history; and the actions in three groups, none of them disabled by the device status (leader UAT 2026-11-06).
// A view over the connector's registry: it opens no port of its own, and the unit shown is kept in memory only.

const NOT_READ = 'Not read';

type Fact = [string, React.ReactNode];

const FactGroup: React.FC<{ id: string; title: string; icon: LucideIcon; items: Fact[]; children?: React.ReactNode }> = ({
  id,
  title,
  icon: Icon,
  items,
  children,
}) => (
  <Card as="section" aria-labelledby={id} className="flex min-w-0 flex-col gap-3">
    <h3 id={id} className="flex items-center gap-2 text-title-sm text-ink">
      <Icon aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-muted" />
      {title}
    </h3>
    {children}
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 min-[420px]:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)]">
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-body-sm text-ink-muted">{label}</dt>
          <dd className="min-w-0 break-words text-body-sm text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  </Card>
);

// The battery as the unit reports it, else the server projection (design section 12.13, Q10 A).
const batteryOf = (connection: Connection): { level: number | null; external: boolean; volts: number | null; source: string } => {
  const unit = connection.unit;
  const level = unit?.batteryLevel ?? null;
  if (level !== null) {
    // Meshtastic reports a level above 100 while the unit runs on external power.
    return { level: Math.min(level, 100), external: level > 100, volts: unit?.voltage ?? null, source: 'from the unit' };
  }
  const server = connection.recognized?.device?.batteryPct ?? null;
  return { level: server, external: false, volts: null, source: server === null ? 'not reported' : 'from the server' };
};

const BatteryGauge: React.FC<{ level: number | null; external: boolean }> = ({ level, external }) => {
  if (level === null) return null;
  const tone = level <= 20 ? 'bg-status-critical-strong' : level <= 40 ? 'bg-status-attention-strong' : 'bg-status-done-strong';
  const label = external ? 'Battery, external power' : `Battery ${level} %`;
  return (
    <div className="flex items-center gap-3">
      <meter min={0} max={100} low={21} high={41} optimum={100} value={level} aria-label={label} className="sr-only">
        {level} %
      </meter>
      <div aria-hidden="true" className="h-3 flex-1 overflow-hidden rounded-badge border border-line-strong bg-sunken">
        <div className={cn('h-full', tone)} style={{ width: `${level}%` }} />
      </div>
      <span className="text-body font-semibold text-ink" aria-hidden="true">
        {external ? 'External power' : `${level} %`}
      </span>
    </div>
  );
};

const HISTORY_ICON: Record<DeviceHistoryItem['kind'], LucideIcon> = {
  STATE: Activity,
  INTAKE: ClipboardCheck,
  PROVISIONING: ShieldAlert,
  RESET: RotateCcw,
  INSPECTION: ClipboardCheck,
  MAINTENANCE: Wrench,
  CONTRACT: Handshake,
  INCIDENT: Siren,
  HUB: Cpu,
};

// The device history of the device page (monitoring api-design 07), newest first, in its own scroll region.
const HistoryPanel: React.FC<{ deviceId: string | null; className?: string; listClassName?: string }> = ({
  deviceId,
  className,
  listClassName,
}) => {
  const feed = useDeviceHistoryFeed(deviceId);
  const items = feed.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Card as="section" aria-labelledby="hub-history-title" className={cn('flex min-h-0 flex-col gap-3', className)}>
      <h3 id="hub-history-title" className="flex items-center gap-2 text-title-sm text-ink">
        <HistoryIcon aria-hidden="true" className="h-5 w-5 text-ink-muted" />
        History
      </h3>
      {!deviceId ? (
        <p className="text-body-sm text-ink-muted">Register this unit to keep its history.</p>
      ) : feed.isLoading ? (
        <p className="text-body-sm text-ink-muted">Reading the history…</p>
      ) : feed.error ? (
        <p role="alert" className="text-body-sm text-ink">
          The history could not be read.
        </p>
      ) : items.length === 0 ? (
        <p className="text-body-sm text-ink-muted">Nothing recorded yet.</p>
      ) : (
        <div
          role="region"
          aria-label="Device history"
          tabIndex={0}
          className={cn(
            'min-h-0 flex-1 overflow-y-auto overscroll-contain rounded-control outline-none focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus',
            listClassName,
          )}
        >
          <ol className="flex flex-col">
            {items.map((item, index) => {
              const Icon = HISTORY_ICON[item.kind] ?? Activity;
              return (
                <li key={`${item.at}-${index}`} className="flex gap-3 border-b border-line py-2 last:border-b-0">
                  <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-ink-muted" />
                  <div className="min-w-0">
                    <p className="break-words text-body-sm text-ink">{item.summary}</p>
                    <p className="text-caption text-ink-muted">
                      <time dateTime={item.at}>{formatDateTime(item.at)}</time>
                      {item.actor ? `, ${item.actor}` : ''}
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
          {feed.hasNextPage && (
            <div className="pt-2">
              <Button variant="secondary" size="sm" loading={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};

type Pending =
  | { kind: 'reboot' | 'restoreDefaults' | 'factoryReset'; connection: Connection; confirm: HubConfirm | null }
  | { kind: 'uplink' | 'flash'; connection: Connection; confirm: HubConfirm };

type Running = 'reboot' | 'restoreDefaults' | 'factoryReset' | null;

const statusEntry = (status: string) =>
  DEVICE_STATUS[status as DeviceStatus] ?? { label: status, tone: 'neutral' as const };

// `timings` is for tests, which cannot wait for a real unit's restart.
export const DeviceHub: React.FC<{ timings?: DockTimings }> = ({ timings }) => {
  // Two columns from 1100 px, actions first below 600 px (screen 4.7, W39).
  const wide = useMediaQuery('(min-width: 1100px)');
  const phone = !useMediaQuery('(min-width: 600px)');
  const navigate = useNavigate();
  const { registry, snapshot } = useConnector();
  const docking = useDocking({ timings });
  const roles = useSession((state) => state.user?.roles ?? []);
  const staff = hasAnyRole(roles, ['STAFF']);
  const context = useConnectorStore((state) => state.context);
  const flashPanel = useConnectorStore((state) => state.flashPanel);
  const hubUnit = useConnectorStore((state) => state.hubUnit);
  const showInHub = useConnectorStore((state) => state.showInHub);
  const openFor = useConnectorStore((state) => state.openFor);
  const setOpen = useConnectorStore((state) => state.setOpen);
  const view = useConnectorStore((state) => state.view);
  const [uplink, setUplink] = useState<{ connection: Connection; confirmAssetTag?: string } | null>(null);
  const [flashing, setFlashing] = useState<{ connection: Connection; confirmAssetTag?: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [running, setRunning] = useState<Running>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Focus goes to the Actions heading once a write ends (screen 4.7): the button that ran it is disabled while the
  // unit is written and read again, so focus would otherwise fall to the page body.
  const [writesEnded, setWritesEnded] = useState(0);
  const actionsHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (writesEnded > 0) actionsHeading.current?.focus();
  }, [writesEnded]);

  const live = snapshot.connections;
  const selected = live.find((connection) => connection.id === hubUnit) ?? live[0] ?? null;
  const device = selected?.recognized?.device ?? null;
  const contract = selected?.recognized?.contract ?? null;
  const record = useQuery({
    queryKey: deviceKeys.device(device?.id ?? ''),
    queryFn: () => fetchDevice(device?.id ?? ''),
    enabled: Boolean(device?.id),
  });
  const releases = useFirmwareReleases(undefined, staff && Boolean(device));
  const flashUnavailable = useFlashAvailability(staff && flashPanel !== null);
  const can = useMemo(
    () => ({ register: staff, operate: staff, flash: flashPanel !== null, flashUnavailable }),
    [staff, flashPanel, flashUnavailable],
  );
  const actions = selected
    ? hubActionsFor(selected, context, can, device ? (record.data ?? undefined) : null, snapshot.writing)
    : [];

  const toast = (message: string) => useToast.getState().show(message);

  // Status refresh (design section 12.14, REQ-EVT-49): the recognition of every unit and the device queries.
  const { refresh, refreshing } = useConnectorRefresh();
  const refreshedAt = useConnectorStore((state) => state.refreshedAt);

  const runReboot = async (connection: Connection, confirmAssetTag?: string) => {
    const target = connection.recognized?.device;
    setFailure(null);
    setRunning('reboot');
    const outcome = await docking.reboot(connection.id, target ? { deviceId: target.id, confirmAssetTag } : null);
    setRunning(null);
    setPending(null);
    setWritesEnded((count) => count + 1);
    void refresh(target?.id);
    if (outcome.ok) toast(`${unitName(connection)} restarted.`);
    else setFailure(rebootMessage(outcome, unitName(connection)));
  };

  const runWrite = async (kind: 'restoreDefaults' | 'factoryReset', connection: Connection, confirmAssetTag?: string) => {
    const target = connection.recognized?.device;
    if (!target) return;
    setFailure(null);
    setRunning(kind);
    const unit = { deviceId: target.id, assetTag: target.assetTag, nodeNum: target.nodeNum, confirmAssetTag };
    const outcome =
      kind === 'factoryReset'
        ? await docking.factoryReset(connection.id, unit)
        : await docking.restoreDefaults(connection.id, unit);
    setRunning(null);
    setPending(null);
    setWritesEnded((count) => count + 1);
    void refresh(target.id);
    if (outcome.ok) {
      toast(
        kind === 'factoryReset' ? `${target.assetTag} is reset.` : `${target.assetTag} is back on the TrekLink defaults.`,
      );
    } else if (kind === 'factoryReset') {
      setFailure(factoryResetMessage(outcome, target.assetTag));
    } else {
      setFailure(
        `${target.assetTag} is not back on the TrekLink defaults: ${outcome.reason}${
          outcome.wiped ? ' The unit was written; the record is missing.' : ''
        }`,
      );
    }
  };

  const onAction = (connection: Connection, action: HubAction) => {
    if (!action.available) return;
    const confirm = action.confirm;
    switch (action.kind) {
      case 'reboot':
        if (confirm?.typed) setPending({ kind: 'reboot', connection, confirm });
        else void runReboot(connection);
        return;
      case 'restoreDefaults':
      case 'factoryReset':
        setPending({ kind: action.kind, connection, confirm });
        return;
      case 'uplink':
        if (confirm?.typed) setPending({ kind: 'uplink', connection, confirm });
        else setUplink({ connection });
        return;
      case 'flash':
        if (confirm?.typed) setPending({ kind: 'flash', connection, confirm });
        else setFlashing({ connection });
        return;
      case 'provision':
        if (action.unitAction?.kind === 'provision' && context?.kind === 'counter') {
          void context.provision(connection.id, action.unitAction.row);
        } else if (action.link) {
          // The counter of its contract provisions it, focused on this unit (design section 12.14).
          const unit = connection.recognized?.device;
          openFor({ action: 'provision', assetTag: unit?.assetTag, nodeNum: unit?.nodeNum });
          navigate(action.link.to);
        }
        return;
      default:
        setOpen(true);
        view(connection.id);
    }
  };

  // A card's Update firmware or Reboot opened the hub on its unit (design section 12.14): run it once the unit is
  // read, through the same dialogs as the buttons here.
  const hubIntent = useConnectorStore((state) => state.hubIntent);
  const clearHubIntent = useConnectorStore((state) => state.clearHubIntent);
  const intended =
    hubIntent && selected?.id === hubIntent.connectionId
      ? actions.find((action) => action.kind === hubIntent.action)
      : undefined;
  useEffect(() => {
    if (!hubIntent || !selected || !intended) return;
    if (selected.state !== 'ready') return;
    clearHubIntent();
    const connection = selected;
    const action = intended;
    // After this render, as the page's own buttons do: the action opens its dialog or runs.
    void Promise.resolve().then(() => {
      if (action.available) onAction(connection, action);
      else setFailure(`${HUB_LABELS[action.kind]}: ${action.reason ?? 'not available now.'}`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per intent, when the unit is ready
  }, [hubIntent, selected?.id, selected?.state, intended?.available]);

  if (!snapshot.supported) {
    return (
      <Alert tone="warning">Docking needs Chrome or Edge on a desktop. Open TrekLink there to connect units.</Alert>
    );
  }

  const connect = (
    <Button variant="secondary" icon={<Plug />} onClick={() => void registry.connectNew()}>
      Connect a unit
    </Button>
  );

  if (!selected) {
    return (
      <Card className="flex flex-col items-start gap-3">
        <p className="text-body text-ink">
          No unit connected. Plug a unit in with its USB cable, then choose Connect a unit.
        </p>
        {connect}
      </Card>
    );
  }

  const unit = selected.unit;
  const read = (value: React.ReactNode | null | undefined) => (unit ? (value ?? 'Not reported') : NOT_READ);
  const lastReset = record.data?.lastReset?.createdAt;
  const nextStep = record.data?.nextStep?.action;
  const battery = batteryOf(selected);
  const variantCode = device?.hardwareVariant.code ?? null;
  const latest = variantCode ? latestReleaseFor(releases.data, variantCode) : null;
  const unitFirmware = unit?.firmwareVersion ?? device?.firmwareVersion ?? null;
  const updateAvailable = Boolean(latest && unitFirmware && compareFirmware(latest.version, unitFirmware) > 0);
  const waitingReconnect = snapshot.reconnectFor === selected.id;
  const stateText = (state: ConnectionState) => STATE_TEXT[state];

  const header = (
    <Card as="section" aria-labelledby="hub-unit-title" className="flex flex-wrap items-start gap-3 min-[600px]:gap-4">
      <UnitImage code={variantCode} name={device?.hardwareVariant.name ?? null} kind="thumb" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h2 id="hub-unit-title" className="break-words text-title text-ink">
          {device?.assetTag ?? 'Unknown unit'}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {device ? <StatusBadge entry={statusEntry(device.status)} /> : <Badge>Not registered</Badge>}
          <span className="text-body-sm text-ink">{stateText(selected.state)}</span>
          {updateAvailable && latest && (
            <Badge tone="waiting" glyph>
              Update available
            </Badge>
          )}
        </div>
        <p className="text-body-sm text-ink-muted">
          {device?.hardwareVariant.name ?? (unit?.pioEnv ? `Build ${unit.pioEnv}` : NOT_READ)}
          {unitFirmware ? `, firmware ${unitFirmware}` : ''}
          {updateAvailable && latest ? `, ${latest.version} available` : ''}
        </p>
        {selected.message && <p className="text-body-sm text-ink">{selected.message}</p>}
        {waitingReconnect && (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" onClick={() => void docking.reconnect()}>
              Reconnect
            </Button>
            <Button variant="secondary" onClick={() => docking.giveUp()}>
              Stop
            </Button>
          </div>
        )}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 min-[600px]:w-auto min-[600px]:flex-col min-[600px]:items-end">
        <div className="flex items-center gap-2">
          <IconButton
            label="Refresh the unit and its record"
            icon={<RefreshCw className={cn(refreshing && 'animate-spin motion-reduce:animate-none')} />}
            variant="secondary"
            disabled={refreshing}
            onClick={() => void refresh(device?.id)}
          />
          {connect}
        </div>
        <p className="text-caption text-ink-muted" aria-live="polite">
          {refreshedAt ? (
            <>
              Refreshed <time dateTime={refreshedAt.toISOString()}>{formatDateTime(refreshedAt.toISOString())}</time>
            </>
          ) : (
            'Not refreshed yet'
          )}
        </p>
        {device && (
          <Link to={`/t/devices/${device.id}`} className="text-body-sm font-semibold text-brand underline">
            Open device page
          </Link>
        )}
      </div>
    </Card>
  );

  const groups = (
    <div className="grid min-w-0 grid-cols-1 gap-4 min-[1100px]:grid-cols-2">
      <FactGroup
        id="hub-identity"
        title="Identity"
        icon={IdCard}
        items={[
          ['Asset tag', device?.assetTag ?? 'Not registered'],
          ['Node', unit ? <span className="font-mono">{`${unit.nodeNum} (${unit.nodeId})`}</span> : NOT_READ],
          ['Owner', unit ? `${unit.longName || 'none'} (${unit.shortName || 'none'})` : NOT_READ],
          ['Hardware model', read(unit?.hwModel)],
          ['Build', read(unit?.pioEnv)],
        ]}
      />
      <FactGroup
        id="hub-radio"
        title="Radio and region"
        icon={RadioTower}
        items={[
          ['Region', read(unit?.region)],
          ['Modem preset', read(unit?.modemPreset)],
          ['Primary channel', read(unit ? unit.channelName || 'Preset default' : null)],
        ]}
      />
      <FactGroup
        id="hub-power"
        title="Power"
        icon={BatteryMedium}
        items={[
          ['Battery', unit ? (battery.level === null ? 'Not reported' : battery.external ? 'External power' : `${battery.level} %`) : NOT_READ],
          ['Voltage', battery.volts === null ? 'Not reported' : `${battery.volts.toFixed(2)} V`],
          ['Source', battery.source],
        ]}
      >
        <BatteryGauge level={battery.level} external={battery.external} />
      </FactGroup>
      <FactGroup
        id="hub-custody"
        title="Custody and contract"
        icon={Handshake}
        items={[
          ['Status', device ? statusEntry(device.status).label : 'Not registered'],
          ['Contract', contract ? `${contract.code}, ${contract.status}` : 'None'],
          ['Organization', contract?.organization.code ?? 'None'],
          [
            'Key version',
            device?.keyVersion == null
              ? 'None'
              : `v${device.keyVersion}${device.keyOrganization ? `, ${device.keyOrganization.code}` : ''}`,
          ],
          ['Last reset', lastReset ? formatDateTime(lastReset) : device ? 'None recorded' : 'Not registered'],
          ['Next step', nextStep ? nextStep.charAt(0) + nextStep.slice(1).toLowerCase() : 'None'],
          ['Last seen', device?.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never'],
        ]}
      />
      <FactGroup
        id="hub-firmware"
        title="Firmware"
        icon={Box}
        items={[
          ['On the unit', read(unit?.firmwareVersion)],
          ['On record', device?.firmwareVersion ?? 'Not registered'],
          ['Latest release', latest?.version ?? (releases.isLoading ? 'Reading…' : 'None published')],
        ]}
      />
    </div>
  );

  const actionsCard = (
    <Card as="section" aria-labelledby="hub-actions-title" className="flex flex-col gap-4">
      <h2 ref={actionsHeading} id="hub-actions-title" tabIndex={-1} className="flex items-center gap-2 text-title-sm text-ink outline-none">
        <Power aria-hidden="true" className="h-5 w-5 text-ink-muted" />
        Actions
      </h2>
      {HUB_GROUPS.map(({ group, title }) => {
        const inGroup = actions.filter((action) => action.group === group);
        const danger = group === 'danger';
        return (
          <div
            key={group}
            role="group"
            aria-labelledby={`hub-group-${group}`}
            className={cn('flex flex-col gap-2', danger && 'rounded-card border border-status-critical-line p-3')}
          >
            <h3 id={`hub-group-${group}`} className={cn('text-label uppercase', danger ? 'text-status-critical-fg' : 'text-ink-muted')}>
              {title}
            </h3>
            <ul className="grid grid-cols-1 gap-3 min-[600px]:grid-cols-2">
              {inGroup.map((action) => {
                const reasonId = `hub-reason-${action.kind}`;
                return (
                  <li key={action.kind} className="flex min-w-0 flex-col gap-1">
                    <Button
                      variant={danger ? 'danger' : 'secondary'}
                      className="min-h-11 w-full justify-center"
                      disabled={!action.available || running !== null}
                      loading={running === action.kind}
                      aria-describedby={action.reason ? reasonId : undefined}
                      onClick={() => onAction(selected, action)}
                    >
                      {action.label}
                    </Button>
                    {action.reason && (
                      <p id={reasonId} className="text-body-sm text-ink-muted">
                        {action.reason}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </Card>
  );

  const deviceId = device?.id ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {live.length > 1 && (
        <div role="group" aria-label="Connected units" className="flex flex-wrap gap-2">
          {live.map((connection) => (
            <Button
              key={connection.id}
              size="sm"
              variant={connection.id === selected.id ? 'primary' : 'secondary'}
              aria-pressed={connection.id === selected.id}
              onClick={() => showInHub(connection.id)}
            >
              {unitName(connection)}
              <span className="sr-only">, {STATE_TEXT[connection.state]}</span>
            </Button>
          ))}
        </div>
      )}

      {failure && (
        <Alert tone="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Alert>
      )}

      {header}

      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] gap-4">
          <PageScrollBody label="Device info and actions">
            <div className="flex flex-col gap-4 pb-2">
              {groups}
              {actionsCard}
            </div>
          </PageScrollBody>
          <HistoryPanel deviceId={deviceId} />
        </div>
      ) : (
        <PageScrollBody label="Connected unit">
          <div className="flex flex-col gap-4 pb-2">
            {phone && actionsCard}
            {groups}
            {!phone && actionsCard}
            <HistoryPanel deviceId={deviceId} listClassName="max-h-96" />
          </div>
        </PageScrollBody>
      )}

      {pending && (pending.kind === 'reboot' || pending.kind === 'uplink' || pending.kind === 'flash') && (
        <HubActionDialog
          id="hub-confirm"
          title={
            pending.kind === 'reboot'
              ? `Reboot ${pending.confirm?.assetTag ?? unitName(pending.connection)}?`
              : pending.kind === 'uplink'
                ? `Configure ${pending.confirm?.assetTag ?? ''} as an uplink?`
                : `Update the firmware of ${pending.confirm?.assetTag ?? ''}?`
          }
          confirmLabel={pending.kind === 'reboot' ? 'Reboot' : 'Continue'}
          confirm={pending.confirm}
          pending={running === 'reboot'}
          onConfirm={(typed) => {
            if (pending.kind === 'reboot') void runReboot(pending.connection, typed);
            else if (pending.kind === 'uplink') {
              setPending(null);
              setUplink({ connection: pending.connection, confirmAssetTag: typed });
            } else {
              setPending(null);
              setFlashing({ connection: pending.connection, confirmAssetTag: typed });
            }
          }}
          onClose={() => setPending(null)}
        >
          <p className="text-body text-ink">
            {pending.kind === 'reboot'
              ? 'The unit restarts and is read again.'
              : pending.kind === 'uplink'
                ? 'The unit is written with the Wi-Fi and broker settings and restarts once.'
                : 'The unit is written with a firmware release and restarts.'}
          </p>
        </HubActionDialog>
      )}

      {pending?.kind === 'restoreDefaults' && pending.connection.recognized?.device && (
        <HubActionDialog
          id="hub-restore"
          title={`Restore TrekLink defaults on ${pending.connection.recognized.device.assetTag}?`}
          confirmLabel="Restore defaults"
          confirm={pending.confirm}
          pending={running === 'restoreDefaults'}
          onConfirm={(typed) => void runWrite('restoreDefaults', pending.connection, typed)}
          onClose={() => setPending(null)}
        >
          <p className="text-body text-ink">
            This writes the owner {pending.connection.recognized.device.assetTag}, puts channel 0 back on the TrekLink
            default key, and turns Wi-Fi and MQTT off. Region, LoRa preset, node database and firmware stay. The unit
            restarts once.
          </p>
        </HubActionDialog>
      )}

      {pending?.kind === 'factoryReset' && pending.connection.recognized?.device && (
        <HubActionDialog
          id="hub-factory-reset"
          title={`Factory reset ${pending.connection.recognized.device.assetTag}?`}
          confirmLabel="Factory reset"
          danger
          confirm={pending.confirm}
          pending={running === 'factoryReset'}
          onConfirm={(typed) => void runWrite('factoryReset', pending.connection, typed)}
          onClose={() => setPending(null)}
        >
          <p className="text-body text-ink">This wipes from the unit:</p>
          <ul className="mt-2 list-disc pl-5 text-body text-ink">
            <li>the channel key of {pending.connection.recognized.device.keyOrganization?.code ?? 'the organization that rented it'}</li>
            <li>the owner names</li>
            <li>the node database</li>
            <li>the Wi-Fi and broker settings, and every other setting, back to factory defaults</li>
          </ul>
          <p className="mt-3 text-body text-ink">
            The owner is set back to {pending.connection.recognized.device.assetTag} and the region{' '}
            {pending.connection.unit?.region ?? 'the unit reports'} is written back. The unit restarts twice, and the
            reset is recorded.
          </p>
        </HubActionDialog>
      )}

      {uplink?.connection.recognized?.device && (
        <ConfigureUplinkDialog
          device={{
            id: uplink.connection.recognized.device.id,
            assetTag: uplink.connection.recognized.device.assetTag,
            nodeNum: uplink.connection.recognized.device.nodeNum,
            keyVersion: uplink.connection.recognized.device.keyVersion,
          }}
          confirmAssetTag={uplink.confirmAssetTag}
          onDone={(message) => {
            const target = uplink.connection.recognized?.device?.id;
            setUplink(null);
            toast(message);
            void refresh(target);
          }}
          onClose={() => setUplink(null)}
        />
      )}

      {flashing?.connection.recognized?.device && flashPanel && (
        <FlashDialog
          connection={flashing.connection}
          confirmAssetTag={flashing.confirmAssetTag}
          panel={flashPanel}
          withPort={(work) => registry.withWriteLock(flashing.connection.id, work)}
          onFlashed={() => void refresh(flashing.connection.recognized?.device?.id)}
          onClose={() => setFlashing(null)}
        />
      )}
    </div>
  );
};

// Update firmware in the hub (design section 12.14): the registered flash panel of task 8.3 in a dialog, on the
// unit's port under the hub's write lock.
const FlashDialog: React.FC<{
  connection: Connection;
  confirmAssetTag?: string;
  panel: FlashPanel;
  withPort: FlashPanelProps['withPort'];
  onFlashed: () => void;
  onClose: () => void;
}> = ({ connection, confirmAssetTag, panel: Panel, withPort, onFlashed, onClose }) => {
  const device = connection.recognized?.device;
  // Stable props, so the panel's effects run once per unit.
  const props = useMemo(
    () =>
      device
        ? {
            device: {
              id: device.id,
              assetTag: device.assetTag,
              nodeNum: device.nodeNum,
              variantCode: device.hardwareVariant.code,
              maintenanceRecordId:
                device.openMaintenance?.reason === 'FIRMWARE_UPDATE' && device.openMaintenance.status === 'OPEN'
                  ? device.openMaintenance.id
                  : null,
              reportedFirmware: connection.unit?.firmwareVersion ?? null,
              firmwareOnRecord: device.firmwareVersion,
            },
          }
        : null,
    // The unit's identity, not the object the snapshot rebuilds on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [device?.id],
  );
  if (!props) return null;
  return (
    <Dialog titleId="hub-flash-title" title={`Update firmware of ${props.device.assetTag}`} onClose={onClose} size="lg">
      <Panel
        device={props.device}
        confirmAssetTag={confirmAssetTag}
        withPort={withPort}
        onFlashed={onFlashed}
        onClose={onClose}
      />
    </Dialog>
  );
};
