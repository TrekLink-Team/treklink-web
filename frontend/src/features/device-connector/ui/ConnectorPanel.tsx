import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plug, X } from 'lucide-react';
import { useSession } from '../../../entities/session/model';
import { hasAnyRole } from '../../../shared/lib/permissions';
import { Alert } from '../../../shared/ui/Alert';
import { Button } from '../../../shared/ui/Button';
import { buttonClasses } from '../../../shared/ui/buttonStyles';
import { ConfirmDialog, Dialog } from '../../../shared/ui/Dialog';
import { Field, Select } from '../../../shared/ui/Field';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import { useToast } from '../../../shared/ui/toastStore';
import { ConfigureUplinkDialog } from '../actions/ConfigureUplinkDialog';
import type { Connection, ConnectionState } from '../model/ConnectorRegistry';
import { actionsFor, type UnitAction } from '../model/actionsFor';
import {
  useConnectorStore,
  type CounterRow,
  type FlashPanel,
  type FlashPanelProps,
} from '../model/connectorStore';
import { useConnector } from '../model/useConnector';
import { UnitImage } from './UnitImage';
import { ConnectorList } from './ConnectorList';
import { STATE_TEXT, unitName } from '../model/text';
import { useFlashAvailability } from '../model/useFlashAvailability';

// The device connector panel, the Staff device hub (devices design section 12.2, screen 4.6): the rows of
// the connected units through the shared CollectionView (ConnectorList), and the device view of one unit,
// whose actions are labelled buttons.

interface ActionHandlers {
  writing: number | null;
  onAction: (connection: Connection, action: UnitAction) => void;
}

// One action of the device view as a labelled button or link (§9.8: every item action as a labelled
// button, with any unavailable reason as text).
const ActionControl: React.FC<
  { connection: Connection; action: UnitAction } & ActionHandlers
> = ({ connection, action, writing, onAction }) => {
  const name = unitName(connection);
  const locked = writing !== null;
  if (action.kind === 'link') {
    return (
      <Link to={action.to} className={buttonClasses('secondary', 'sm')} aria-label={`${action.label}: ${name}`}>
        {action.label}
      </Link>
    );
  }
  if (action.kind === 'flash') {
    // Unavailable until task 8.3 registers its panel; the reason is text beside it (chapter 06 §9.8).
    return (
      <Button
        size="sm"
        variant="secondary"
        disabled={action.disabledReason !== null || locked}
        aria-label={`Update firmware: ${name}`}
        aria-describedby={action.disabledReason ? `flash-reason-${connection.id}` : undefined}
        onClick={() => onAction(connection, action)}
      >
        Update firmware
      </Button>
    );
  }
  const label =
    action.kind === 'register'
      ? 'New device: register it?'
      : action.kind === 'provision'
        ? 'Provision'
        : action.kind === 'swap'
          ? 'Put on this contract'
          : 'Configure uplink';
  const accessible =
    action.kind === 'register' ? `New device ${connection.unit?.nodeId ?? ''}: register it?` : `${label}: ${name}`;
  const writes = action.kind !== 'register';
  return (
    <Button
      size="sm"
      variant={action.kind === 'register' || action.kind === 'swap' || action.kind === 'provision' ? 'primary' : 'secondary'}
      disabled={writes && locked}
      aria-label={accessible}
      onClick={() => onAction(connection, action)}
    >
      {label}
    </Button>
  );
};

// The quick swap's confirmation (screen 4.6 Actions, design section 12.6): the reserved unit to replace,
// the first not provisioned preselected (decided Q7 A).
const SwapDialog: React.FC<{
  dockedTag: string;
  contractCode: string;
  rows: CounterRow[];
  // The server's refusal of the exchange, or null once it went through.
  onConfirm: (row: CounterRow) => Promise<string | null>;
  onClose: () => void;
}> = ({ dockedTag, contractCode, rows, onConfirm, onClose }) => {
  const [deviceId, setDeviceId] = useState(rows[0]?.deviceId ?? '');
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const row = rows.find((candidate) => candidate.deviceId === deviceId);
  const confirm = async () => {
    if (!row) return;
    setPending(true);
    setRefusal(null);
    const message = await onConfirm(row);
    setPending(false);
    // A refused exchange changed nothing: the dialog stays open with the server's reason (screen 4.6).
    if (message) setRefusal(message);
    else onClose();
  };
  return (
    <Dialog
      titleId="connector-swap-title"
      title={`Put ${dockedTag} on ${contractCode}?`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!row} loading={pending} onClick={() => void confirm()}>
            Swap and provision
          </Button>
        </div>
      }
    >
      <p className="text-body text-ink">
        {row?.assetTag ?? 'The replaced unit'} goes back to Available. {dockedTag} is reserved and provisioned
        now. Price and quantity do not change.
      </p>
      <Field id="connector-swap-replace" label="Replace" className="mt-4" required>
        <Select id="connector-swap-replace" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
          {rows.map((candidate) => (
            <option key={candidate.deviceId} value={candidate.deviceId}>
              {candidate.assetTag}
            </option>
          ))}
        </Select>
      </Field>
      {refusal && (
        <Alert tone="error" className="mt-4">
          {refusal}
        </Alert>
      )}
    </Dialog>
  );
};

const DetailList: React.FC<{ items: [string, React.ReactNode][] }> = ({ items }) => (
  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
    {items.map(([label, value]) => (
      <React.Fragment key={label}>
        <dt className="text-ink-muted">{label}</dt>
        <dd className="min-w-0 break-words text-ink">{value}</dd>
      </React.Fragment>
    ))}
  </dl>
);

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString() : 'Never');

// The device view of one unit (design section 12.2, REQ-EVT-40): the upright render, what the unit
// reports, the server's record and its contract, and every action as a labelled button.
export const DeviceView: React.FC<
  { connection: Connection; reason: string | null; actions: UnitAction[]; onBack: () => void } & ActionHandlers
> = ({ connection, reason, actions, onBack, ...handlers }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const device = connection.recognized?.device ?? null;
  const contract = connection.recognized?.contract ?? null;
  const unit = connection.unit;
  const flash = actions.find((action) => action.kind === 'flash');
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Button size="sm" variant="ghost" onClick={onBack}>
          Back to the list
        </Button>
      </div>
      <h3 ref={heading} tabIndex={-1} className="text-title-sm text-ink outline-none">
        {unitName(connection)}
      </h3>
      <UnitImage code={device?.hardwareVariant.code ?? null} name={device?.hardwareVariant.name ?? null} kind="detail" />
      <Link
        to="/t/device-hub"
        onClick={() => useConnectorStore.getState().showInHub(connection.id)}
        className={buttonClasses('secondary', 'sm')}
      >
        Open in the device hub
      </Link>
      <section aria-labelledby="connector-unit-heading">
        <h4 id="connector-unit-heading" className="mb-1 text-body font-semibold text-ink">
          From the unit
        </h4>
        <DetailList
          items={[
            ['Node id', <span className="font-mono">{unit?.nodeId ?? 'Not read'}</span>],
            ['Node number', unit?.nodeNum ?? 'Not read'],
            ['Owner', unit ? `${unit.longName || 'none'} (${unit.shortName || 'none'})` : 'Not read'],
            ['Build', unit?.pioEnv ?? 'Not reported'],
            ['Firmware', unit?.firmwareVersion ?? 'Not reported'],
            ['Connection', STATE_TEXT[connection.state]],
          ]}
        />
      </section>
      {device ? (
        <section aria-labelledby="connector-record-heading">
          <h4 id="connector-record-heading" className="mb-1 text-body font-semibold text-ink">
            TrekLink record
          </h4>
          <DetailList
            items={[
              ['Asset tag', device.assetTag],
              ['Variant', device.hardwareVariant.name],
              ['Status', DEVICE_STATUS[device.status as DeviceStatus]?.label ?? device.status],
              ['Firmware on record', device.firmwareVersion],
              ['Battery', device.batteryPct === null ? 'Not reported' : `${device.batteryPct} %`],
              ['Last seen', when(device.lastSeenAt)],
              ['Service due', device.serviceDueAt ?? 'Not set'],
              ['Key version', device.keyVersion === null ? 'None' : `v${device.keyVersion}${device.keyOrganization ? `, ${device.keyOrganization.code}` : ''}`],
            ]}
          />
          {unit?.firmwareVersion && device.firmwareBaseline && !unit.firmwareVersion.startsWith(device.firmwareBaseline.split('-')[0]) && (
            <p className="mt-2 text-body-sm text-status-attention-fg">The unit reports {unit.firmwareVersion}.</p>
          )}
        </section>
      ) : (
        <p className="text-body text-ink">This unit is not registered.</p>
      )}
      {contract && (
        <section aria-labelledby="connector-contract-heading">
          <h4 id="connector-contract-heading" className="mb-1 text-body font-semibold text-ink">
            Contract
          </h4>
          <DetailList
            items={[
              ['Contract', contract.code],
              ['Organization', contract.organization.code ?? 'Unknown'],
              ['Status', contract.status],
              ['Provisioned', contract.provisionedKeyVersion === null ? 'Not provisioned yet' : `v${contract.provisionedKeyVersion}`],
            ]}
          />
        </section>
      )}
      {(connection.message || reason) && <p className="text-body-sm text-ink">{connection.message ?? reason}</p>}
      {flash?.kind === 'flash' && flash.disabledReason && (
        <p id={`flash-reason-${connection.id}`} className="text-caption text-ink-muted">
          {flash.disabledReason}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {actions.map((action, index) => (
          <ActionControl key={`${action.kind}-${index}`} connection={connection} action={action} {...handlers} />
        ))}
      </div>
    </div>
  );
};

// Renders the flash panel task 8.3 registered (design section 12.7). A registered component, not one
// made during the panel's render.
const FlashSlot: React.FC<{ panel: FlashPanel; props: FlashPanelProps }> = ({ panel, props }) =>
  React.createElement(panel, props);

// The panel content shared by the pushed aside and the drawers (screen 4.6 Layout).
export const ConnectorPanelBody: React.FC<{ headingId: string }> = ({ headingId }) => {
  const { registry, snapshot } = useConnector();
  const navigate = useNavigate();
  const roles = useSession((state) => state.user?.roles ?? []);
  const staff = hasAnyRole(roles, ['STAFF']);
  const context = useConnectorStore((state) => state.context);
  const viewing = useConnectorStore((state) => state.viewing);
  const view = useConnectorStore((state) => state.view);
  const focus = useConnectorStore((state) => state.focus);
  const setRegisterFrom = useConnectorStore((state) => state.setRegisterFrom);
  const clearFocus = useConnectorStore((state) => state.clearFocus);
  const flashPanel = useConnectorStore((state) => state.flashPanel);
  const [flashing, setFlashing] = useState<Connection | null>(null);
  const [forgetting, setForgetting] = useState<Connection | null>(null);
  // Back from the device view returns focus to the row that opened it (screen 4.6).
  const lastViewed = useRef<number | null>(null);
  useEffect(() => {
    if (viewing !== null) {
      lastViewed.current = viewing;
      return;
    }
    if (lastViewed.current === null) return;
    // Its Show details button from 600 px; below that a phone row has none, and its Actions menu, which
    // opened the view, takes the focus (walk of task 4.6: it fell to the page body).
    const row = document.querySelector<HTMLElement>(`[data-cv-item="${lastViewed.current}"]`);
    const buttons = row ? Array.from(row.querySelectorAll<HTMLElement>('button')) : [];
    const named = (prefix: string) =>
      buttons.find((button) => (button.getAttribute('aria-label') ?? button.textContent ?? '').trim().startsWith(prefix));
    (named('Show details') ?? named('Actions for') ?? buttons[0])?.focus();
    lastViewed.current = null;
  }, [viewing]);
  const [swap, setSwap] = useState<{ connection: Connection; rows: CounterRow[] } | null>(null);
  const [uplink, setUplink] = useState<Connection | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const known = useRef(new Map<number, ConnectionState>());

  // The polite live region (screen 4.6): a unit that arrives or leaves is announced, not focused.
  useEffect(() => {
    for (const connection of snapshot.connections) {
      const before = known.current.get(connection.id);
      if (before === undefined && connection.state !== 'unplugged') setAnnouncement(`${unitName(connection)} connected`);
      if (before !== 'ready' && connection.state === 'ready' && before !== undefined) setAnnouncement(`${unitName(connection)} ready`);
      if (before !== 'unplugged' && connection.state === 'unplugged') setAnnouncement(`${unitName(connection)} unplugged`);
      known.current.set(connection.id, connection.state);
    }
  }, [snapshot.connections]);

  const flashUnavailable = useFlashAvailability(staff && flashPanel !== null);
  const can = useMemo(
    () => ({ register: staff, operate: staff, flash: flashPanel !== null, flashUnavailable }),
    [staff, flashPanel, flashUnavailable],
  );
  const actionsOf = useCallback(
    (connection: Connection) => actionsFor(connection, context, can),
    [context, can],
  );

  const onAction = (connection: Connection, action: UnitAction) => {
    if (action.kind === 'register') {
      setRegisterFrom(connection.id);
      navigate('/t/fleet?register=1');
      return;
    }
    if (action.kind === 'provision' && context?.kind === 'counter') {
      void context.provision(connection.id, action.row);
      return;
    }
    if (action.kind === 'swap') {
      setSwap({ connection, rows: action.rows });
      return;
    }
    if (action.kind === 'uplink') setUplink(connection);
    if (action.kind === 'flash' && action.disabledReason === null) setFlashing(connection);
  };

  const viewed = viewing === null ? undefined : snapshot.connections.find((connection) => connection.id === viewing);
  // An entry point names its unit by node number, or by asset tag alone (the maintenance record, task 8.3).
  const matchesFocus = (connection: Connection) =>
    focus?.nodeNum != null
      ? connection.unit?.nodeNum === focus.nodeNum
      : connection.recognized?.device?.assetTag === focus?.assetTag;
  const missing = focus?.assetTag && !snapshot.connections.some(matchesFocus) ? focus.assetTag : null;
  // Configure uplink from the device page opens the hub on its unit (REQ-EVT-41, REQ-EVT-42): once that
  // unit is connected and recognized the dialog opens here; until then the panel asks to connect it.
  const focusedUplink =
    focus?.action === 'uplink'
      ? snapshot.connections.find(
          (connection) =>
            connection.unit?.nodeNum === focus.nodeNum &&
            connection.state === 'ready' &&
            connection.recognized?.device,
        )
      : undefined;
  const uplinkConnection = uplink ?? focusedUplink ?? null;
  const uplinkDevice = uplinkConnection?.recognized?.device;
  const closeUplink = () => {
    setUplink(null);
    if (focus?.action === 'uplink') clearFocus();
  };
  // Update firmware from the hub page or a maintenance record opens the flash panel on its unit once that
  // unit is connected, recognized and allowed to flash (REQ-EVT-43, task 8.3).
  const focusedFlash =
    focus?.action === 'flash'
      ? snapshot.connections.find(
          (connection) =>
            matchesFocus(connection) &&
            connection.state === 'ready' &&
            actionsFor(connection, context, can).actions.some(
              (action) => action.kind === 'flash' && action.disabledReason === null,
            ),
        )
      : undefined;
  const flashConnection = flashing ?? focusedFlash ?? null;
  const flashDevice = flashConnection?.recognized?.device;
  // Stable props for the flash panel of task 8.3, so its effects run once per unit.
  const flashingId = flashConnection?.id ?? null;
  const flashRecord = flashDevice?.openMaintenance?.id ?? null;
  const flashProps = useMemo(
    () =>
      flashDevice && flashRecord && flashingId !== null
        ? {
            device: {
              id: flashDevice.id,
              assetTag: flashDevice.assetTag,
              nodeNum: flashDevice.nodeNum,
              variantCode: flashDevice.hardwareVariant.code,
              maintenanceRecordId: flashRecord,
            },
            withPort: <T,>(
              work: (port: SerialPort, stage: (state: ConnectionState) => void) => Promise<T>,
            ) => registry.withWriteLock(flashingId, work),
          }
        : null,
    // The unit's identity, not the object the snapshot rebuilds on every change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flashingId, flashDevice?.id, flashRecord, registry],
  );

  return (
    <div className="flex flex-col gap-3">
      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
      {!snapshot.supported && (
        <Alert tone="warning">Docking needs Chrome or Edge on a desktop. Open TrekLink there to connect units.</Alert>
      )}
      {viewed ? (
        <DeviceView
          connection={viewed}
          {...actionsFor(viewed, context, can)}
          writing={snapshot.writing}
          onAction={onAction}
          onBack={() => view(null)}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p id={`${headingId}-count`} className="flex-1 text-body-sm text-ink-muted">
              {snapshot.connections.length === 1 ? '1 unit connected' : `${snapshot.connections.length} units connected`}
            </p>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plug />}
              disabled={!snapshot.supported}
              onClick={() => void registry.connectNew()}
            >
              Connect a unit
            </Button>
          </div>
          {missing && <p className="text-body-sm font-semibold text-ink">Connect {missing} to continue.</p>}
          <ConnectorList
            label="Connected units"
            snapshot={snapshot}
            actionsOf={actionsOf}
            onAction={onAction}
            onShow={view}
            onRetry={(id) => registry.retry(id)}
            onForget={setForgetting}
            onReconnect={() => void registry.reconnectOffer?.reconnect()}
            onStopReconnect={() => registry.reconnectOffer?.stop()}
          />
        </>
      )}
      {forgetting && (
        <ConfirmDialog
          titleId="connector-forget-title"
          title={`Forget ${unitName(forgetting)}?`}
          description="The browser asks again before it can connect to this unit."
          confirmLabel="Forget"
          cancelLabel="Keep it"
          onConfirm={() => {
            const target = forgetting;
            setForgetting(null);
            void registry.forget(target.id);
          }}
          onCancel={() => setForgetting(null)}
        />
      )}
      {swap && context?.kind === 'counter' && (
        <SwapDialog
          dockedTag={swap.connection.recognized?.device?.assetTag ?? unitName(swap.connection)}
          contractCode={context.contractCode}
          rows={swap.rows}
          onClose={() => setSwap(null)}
          onConfirm={(row) => context.swapIn(swap.connection.id, row)}
        />
      )}
      {uplinkConnection && uplinkDevice && (
        <ConfigureUplinkDialog
          device={{
            id: uplinkDevice.id,
            assetTag: uplinkDevice.assetTag,
            nodeNum: uplinkDevice.nodeNum,
            keyVersion: uplinkDevice.keyVersion,
          }}
          onDone={(message) => {
            closeUplink();
            useToast.getState().show(message);
            void registry.refreshRecognition(uplinkConnection.id);
          }}
          onClose={closeUplink}
        />
      )}
      {flashPanel && flashProps && (
        <FlashSlot
          panel={flashPanel}
          props={{
            ...flashProps,
            onClose: () => {
              setFlashing(null);
              if (focus?.action === 'flash') clearFocus();
            },
          }}
        />
      )}
    </div>
  );
};

// The panel's frame: the pushed aside from 1100 px; the drawers are placed by the shell (screen 4.6).
export const ConnectorAside: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  const frame = useRef<HTMLElement>(null);
  // Focus moves to the heading on open and back to the control that opened the panel on close
  // (screen 4.6): the aside is not a Drawer, so nothing else returns it. A close that leaves focus
  // elsewhere on purpose, a click on another control, keeps that focus.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const aside = frame.current;
    heading.current?.focus();
    return () => {
      const active = document.activeElement;
      const lost = active === null || active === document.body || (aside?.contains(active) ?? false);
      if (!lost) return;
      const target =
        opener && opener.isConnected && !aside?.contains(opener)
          ? opener
          : document.querySelector<HTMLElement>('button[aria-label^="Devices, "]');
      target?.focus();
    };
  }, []);
  return (
    <aside
      ref={frame}
      aria-labelledby="device-connector-title"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented) onClose();
      }}
      className="tl-glass flex w-[22.5rem] shrink-0 flex-col overflow-hidden rounded-panel"
    >
      <div className="flex min-h-[3.25rem] items-center gap-2 border-b border-line pl-4 pr-1.5">
        <h2
          ref={heading}
          tabIndex={-1}
          id="device-connector-title"
          className="min-w-0 flex-1 truncate font-display text-body-lg font-extrabold text-ink outline-none"
        >
          Connected units
        </h2>
        <button
          type="button"
          aria-label="Close connected units"
          onClick={onClose}
          className="flex h-11 w-11 items-center justify-center rounded-control text-ink hover:bg-chrome/60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
        >
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <ConnectorPanelBody headingId="device-connector-title" />
      </div>
    </aside>
  );
};
