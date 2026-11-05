import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plug } from 'lucide-react';
import { deviceKeys, fetchDevice } from '../../../entities/device/api';
import { useSession } from '../../../entities/session/model';
import { formatDateTime } from '../../../shared/lib/format';
import type { DockTimings } from '../../../shared/lib/meshtastic-dock';
import { hasAnyRole } from '../../../shared/lib/permissions';
import { Alert } from '../../../shared/ui/Alert';
import { Button } from '../../../shared/ui/Button';
import { buttonClasses } from '../../../shared/ui/buttonStyles';
import { Card } from '../../../shared/ui/Card';
import { Dialog } from '../../../shared/ui/Dialog';
import { PageScrollBody } from '../../../shared/ui/PageChrome';
import { useMediaQuery } from '../../../shared/lib/useMediaQuery';
import { cn } from '../../../shared/ui/cn';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import { useToast } from '../../../shared/ui/toastStore';
import { ConfigureUplinkDialog } from '../actions/ConfigureUplinkDialog';
import { factoryResetMessage, rebootMessage } from '../actions/messages';
import { useDocking } from '../actions/useDocking';
import type { Connection } from '../model/ConnectorRegistry';
import { useConnectorStore } from '../model/connectorStore';
import { hubActionsFor, type HubAction } from '../model/hubActions';
import { STATE_TEXT, unitName } from '../model/text';
import { useConnector } from '../model/useConnector';
import { useFlashAvailability } from '../model/useFlashAvailability';
import { UnitImage } from './UnitImage';

// The device hub page (devices design section 12.13, screen 4.7, REQ-EVT-44): one connected unit at a
// time, its render and state on the left, its Device info and its six actions on the right. A view over
// the connector's registry: it opens no port of its own, and the unit shown is kept in memory only.

const NOT_READ = 'Not read';

const Facts: React.FC<{ items: [string, React.ReactNode][]; id: string }> = ({ items, id }) => (
  <dl aria-labelledby={id} className="grid grid-cols-1 gap-x-6 gap-y-3 min-[1100px]:grid-cols-2">
    {items.map(([label, value]) => (
      <div key={label} className="min-w-0">
        <dt className="text-label uppercase text-ink-muted">{label}</dt>
        <dd className="mt-0.5 break-words text-body text-ink">{value}</dd>
      </div>
    ))}
  </dl>
);

const batteryText = (connection: Connection): string => {
  const unit = connection.unit;
  const level = unit?.batteryLevel ?? null;
  if (level !== null) {
    // Meshtastic reports a level above 100 while the unit runs on external power.
    const shown = level > 100 ? 'External power' : `${level}%`;
    const volts = unit?.voltage ?? null;
    return `${shown}${volts === null ? '' : `, ${volts.toFixed(2)} V`} (from the unit)`;
  }
  const server = connection.recognized?.device?.batteryPct ?? null;
  return server === null ? 'Not reported' : `${server}% (from the server; the unit reports none yet)`;
};

const statusText = (status: string) => DEVICE_STATUS[status as DeviceStatus]?.label ?? status;

// The factory reset confirmation (screen 4.7 Actions): what is wiped, what is written back, the two
// restarts and the record.
const FactoryResetDialog: React.FC<{
  assetTag: string;
  organization: string | null;
  region: string | null;
  pending: boolean;
  onConfirm: () => void;
  onClose: () => void;
}> = ({ assetTag, organization, region, pending, onConfirm, onClose }) => {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      titleId="hub-factory-reset-title"
      title={`Factory reset ${assetTag}?`}
      onClose={onClose}
      role="alertdialog"
      initialFocus={cancel}
      footer={
        <div className="flex justify-end gap-2">
          <Button ref={cancel} variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={onConfirm}>
            Factory reset
          </Button>
        </div>
      }
    >
      <p className="text-body text-ink">This wipes from the unit:</p>
      <ul className="mt-2 list-disc pl-5 text-body text-ink">
        <li>the channel key of {organization ?? 'the organization that rented it'}</li>
        <li>the owner names</li>
        <li>the node database</li>
        <li>the Wi-Fi and broker settings, and every other setting, back to factory defaults</li>
      </ul>
      <p className="mt-3 text-body text-ink">
        The owner is set back to {assetTag} and the region {region ?? 'the unit reports'} is written back. The unit
        restarts twice, and the reset is recorded for this return.
      </p>
    </Dialog>
  );
};

// `timings` is for tests, which cannot wait for a real unit's restart.
export const DeviceHub: React.FC<{ timings?: DockTimings }> = ({ timings }) => {
  // The two-column layout from 600 px (screen 4.7, Layout).
  const wide = useMediaQuery('(min-width: 600px)');
  const { registry, snapshot } = useConnector();
  const docking = useDocking({ timings });
  const queryClient = useQueryClient();
  const roles = useSession((state) => state.user?.roles ?? []);
  const staff = hasAnyRole(roles, ['STAFF']);
  const context = useConnectorStore((state) => state.context);
  const flashPanel = useConnectorStore((state) => state.flashPanel);
  const hubUnit = useConnectorStore((state) => state.hubUnit);
  const showInHub = useConnectorStore((state) => state.showInHub);
  const setOpen = useConnectorStore((state) => state.setOpen);
  const view = useConnectorStore((state) => state.view);
  const [uplink, setUplink] = useState<Connection | null>(null);
  const [resetting, setResetting] = useState<Connection | null>(null);
  const [running, setRunning] = useState<'reboot' | 'factoryReset' | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  // Focus goes to the Actions heading once a write ends (screen 4.7): the button that ran it is disabled
  // while the unit is written and read again, and after a factory reset it stays disabled, so focus would
  // otherwise fall to the page body. A counter, so each write moves it once.
  const [writesEnded, setWritesEnded] = useState(0);
  const actionsHeading = useRef<HTMLHeadingElement>(null);
  // Runs after the reset dialog unmounted and returned focus to its trigger, so this focus wins.
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
  const flashUnavailable = useFlashAvailability(staff && flashPanel !== null);
  const can = useMemo(
    () => ({ register: staff, operate: staff, flash: flashPanel !== null, flashUnavailable }),
    [staff, flashPanel, flashUnavailable],
  );
  const actions = selected
    ? hubActionsFor(selected, context, can, device ? (record.data ?? undefined) : null, snapshot.writing)
    : [];

  const toast = (message: string) => useToast.getState().show(message);

  const runReboot = async (connection: Connection) => {
    setFailure(null);
    setRunning('reboot');
    const outcome = await docking.reboot(connection.id);
    setRunning(null);
    setWritesEnded((count) => count + 1);
    if (outcome.ok) toast(`${unitName(connection)} restarted.`);
    else setFailure(rebootMessage(outcome, unitName(connection)));
  };

  const runFactoryReset = async (connection: Connection) => {
    const target = connection.recognized?.device;
    if (!target) return;
    setFailure(null);
    setRunning('factoryReset');
    const outcome = await docking.factoryReset(connection.id, {
      deviceId: target.id,
      assetTag: target.assetTag,
      nodeNum: target.nodeNum,
    });
    setRunning(null);
    setResetting(null);
    setWritesEnded((count) => count + 1);
    void queryClient.invalidateQueries({ queryKey: deviceKeys.device(target.id) });
    if (outcome.ok) toast(`${target.assetTag} is reset. Inspect it at the counter next.`);
    else setFailure(factoryResetMessage(outcome, target.assetTag));
  };

  // Provision, Quick swap and Update firmware run where they already live: the panel on this unit, which
  // holds their dialogs and the flash panel of task 8.3 (devices design section 12.7).
  const onAction = (connection: Connection, action: HubAction) => {
    if (!action.available) return;
    if (action.kind === 'reboot') void runReboot(connection);
    else if (action.kind === 'factoryReset') setResetting(connection);
    else if (action.kind === 'uplink') setUplink(connection);
    else if (action.kind === 'provision' && action.unitAction?.kind === 'provision' && context?.kind === 'counter') {
      void context.provision(connection.id, action.unitAction.row);
    } else if (action.kind === 'flash' && connection.recognized?.device) {
      // The panel opens the flash panel on this unit at once (REQ-EVT-43, task 8.3).
      const unit = connection.recognized.device;
      useConnectorStore.getState().openFor({ action: 'flash', assetTag: unit.assetTag, nodeNum: unit.nodeNum });
    } else {
      setOpen(true);
      view(connection.id);
    }
  };

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
  const infoItems: [string, React.ReactNode][] = [
    ['Asset tag', device?.assetTag ?? 'Not registered'],
    ['Variant', device?.hardwareVariant.name ?? (unit?.pioEnv ? `Build ${unit.pioEnv}` : NOT_READ)],
    ['Node number', unit ? <span className="font-mono">{`${unit.nodeNum} (${unit.nodeId})`}</span> : NOT_READ],
    ['Firmware', unit ? `${unit.firmwareVersion ?? 'Not reported'}${device ? `; on record ${device.firmwareVersion}` : ''}` : NOT_READ],
    ['Hardware model', read(unit?.hwModel)],
    ['Battery', unit ? batteryText(selected) : NOT_READ],
    ['Region', read(unit?.region ? `${unit.region}${unit.modemPreset ? `, ${unit.modemPreset}` : ''}` : null)],
    ['Primary channel', read(unit ? unit.channelName || 'Preset default' : null)],
    ['Owner', unit ? `${unit.longName || 'none'} (${unit.shortName || 'none'})` : NOT_READ],
    ['Last seen', device?.lastSeenAt ? formatDateTime(device.lastSeenAt) : 'Never'],
    [
      'Contract',
      contract ? `${contract.code}, ${contract.status}, ${contract.organization.code ?? 'organization unknown'}` : 'None',
    ],
    [
      'Key version',
      device?.keyVersion == null
        ? 'None'
        : `v${device.keyVersion}${device.keyOrganization ? `, ${device.keyOrganization.code}` : ''}`,
    ],
    ['Last reset', lastReset ? formatDateTime(lastReset) : device ? 'None recorded' : 'Not registered'],
  ];

  const waitingReconnect = snapshot.reconnectFor === selected.id;

  // The unit card, Device info and Actions. From 600 px the unit card stays beside a region that scrolls
  // Device info and Actions; on a phone one region scrolls all three (chapter 06 §11.1, ui standard §7).
  const unitCard = (
    <Card as="section" aria-labelledby="hub-unit-title" className="flex flex-col gap-3 self-start">
      <UnitImage code={device?.hardwareVariant.code ?? null} name={device?.hardwareVariant.name ?? null} kind="detail" />
      <h2 id="hub-unit-title" className="text-title-sm text-ink">
        {device?.assetTag ?? 'Unknown unit'}
      </h2>
      <p className="text-body text-ink">
        {device ? statusText(device.status) : 'Not registered'}
        <span className="text-ink-muted"> · </span>
        {STATE_TEXT[selected.state]}
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
      {device && (
        <Link to={`/t/devices/${device.id}`} className={buttonClasses('secondary', 'md')}>
          Open device page
        </Link>
      )}
    </Card>
  );
  const infoAndActions = (
    <div className="flex min-w-0 flex-col gap-4">
      <Card as="section" aria-labelledby="hub-info-title">
        <h2 id="hub-info-title" className="mb-3 text-title-sm text-ink">
          Device info
        </h2>
        <Facts id="hub-info-title" items={infoItems} />
      </Card>

      <Card as="section" aria-labelledby="hub-actions-title">
        <h2 ref={actionsHeading} id="hub-actions-title" tabIndex={-1} className="mb-3 text-title-sm text-ink outline-none">
          Actions
        </h2>
        <ul className="grid grid-cols-1 gap-3 min-[1100px]:grid-cols-2">
          {actions.map((action) => {
            const reasonId = `hub-reason-${action.kind}`;
            return (
              <li key={action.kind} className="flex min-w-0 flex-col gap-1">
                <Button
                  variant={action.kind === 'factoryReset' ? 'danger' : 'secondary'}
                  className="w-full justify-center"
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
                {action.link && (
                  <Link to={action.link.to} className="text-body-sm font-semibold text-brand underline">
                    {action.link.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {live.length > 1 && (
          <div role="group" aria-label="Connected units" className="flex flex-1 flex-wrap gap-2">
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
        <div className={cn(live.length > 1 ? '' : 'ml-auto')}>{connect}</div>
      </div>

      {failure && (
        <Alert tone="error" onDismiss={() => setFailure(null)}>
          {failure}
        </Alert>
      )}

      {wide ? (
        <div className="grid min-h-0 flex-1 grid-cols-[14rem_minmax(0,1fr)] gap-4 min-[1100px]:grid-cols-[18rem_minmax(0,1fr)]">
          {unitCard}
          <PageScrollBody label="Device info and actions">{infoAndActions}</PageScrollBody>
        </div>
      ) : (
        <PageScrollBody label="Connected unit">
          <div className="flex flex-col gap-4">
            {unitCard}
            {infoAndActions}
          </div>
        </PageScrollBody>
      )}

      {resetting?.recognized?.device && (
        <FactoryResetDialog
          assetTag={resetting.recognized.device.assetTag}
          organization={resetting.recognized.device.keyOrganization?.code ?? null}
          region={resetting.unit?.region ?? null}
          pending={running === 'factoryReset'}
          onConfirm={() => void runFactoryReset(resetting)}
          onClose={() => (running ? undefined : setResetting(null))}
        />
      )}
      {uplink?.recognized?.device && (
        <ConfigureUplinkDialog
          device={{
            id: uplink.recognized.device.id,
            assetTag: uplink.recognized.device.assetTag,
            nodeNum: uplink.recognized.device.nodeNum,
            keyVersion: uplink.recognized.device.keyVersion,
          }}
          onDone={(message) => {
            const id = uplink.id;
            setUplink(null);
            toast(message);
            void registry.refreshRecognition(id);
          }}
          onClose={() => setUplink(null)}
        />
      )}
    </div>
  );
};
