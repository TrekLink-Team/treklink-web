import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plug, X } from 'lucide-react';
import { useSession } from '../../../entities/session/model';
import { hasAnyRole } from '../../../shared/lib/permissions';
import { Alert } from '../../../shared/ui/Alert';
import { Button } from '../../../shared/ui/Button';
import { buttonClasses } from '../../../shared/ui/buttonStyles';
import { cn } from '../../../shared/ui/cn';
import { Dialog } from '../../../shared/ui/Dialog';
import { Field, Select } from '../../../shared/ui/Field';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import { ConfigureUplinkDialog } from '../actions/ConfigureUplinkDialog';
import type { Connection, ConnectionState } from '../model/ConnectorRegistry';
import { actionsFor, type UnitAction } from '../model/actionsFor';
import { useConnectorStore, type CounterRow } from '../model/connectorStore';
import { useConnector } from '../model/useConnector';
import { UnitImage } from './UnitImage';
import { RETRYABLE, STATE_TEXT, unitName } from '../model/text';

// The device connector panel, the Staff device hub (devices design section 11.2, screen 4.6): one row per
// connected unit with the actions this unit allows on this page, and the device view of one unit.
// TODO(devices task 10.7, D-096): render the rows through the shared CollectionView of
// `feat/contract-home-ui` once it lands on `dev`; until then they are a plain list with the same
// fields, actions and accessible names.

const statusText = (connection: Connection): string | null => {
  if (!connection.unit || connection.state === 'reading' || connection.state === 'looking-up') {
    return null;
  }
  const device = connection.recognized?.device;
  if (!connection.recognized) return null;
  if (!device) return 'Not registered';
  return DEVICE_STATUS[device.status as DeviceStatus]?.label ?? device.status;
};

interface ActionHandlers {
  writing: number | null;
  onAction: (connection: Connection, action: UnitAction) => void;
}

// One action as a labelled button or link (the label is visible, so no tooltip is needed, §9.5).
const ActionControl: React.FC<
  { connection: Connection; action: UnitAction } & ActionHandlers
> = ({ connection, action, writing, onAction }) => {
  const name = unitName(connection);
  const locked = writing !== null;
  const lockedReason = locked && writing !== connection.id ? 'Another unit is being written.' : undefined;
  if (action.kind === 'link') {
    return (
      <Link to={action.to} className={buttonClasses('secondary', 'sm')} aria-label={`${action.label}: ${name}`}>
        {action.label}
      </Link>
    );
  }
  if (action.kind === 'flash') {
    return (
      <Button size="sm" variant="secondary" disabled aria-describedby={`flash-reason-${connection.id}`}>
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
      title={writes ? lockedReason : undefined}
      onClick={() => onAction(connection, action)}
    >
      {label}
    </Button>
  );
};

const UnitRow: React.FC<
  {
    connection: Connection;
    reason: string | null;
    actions: UnitAction[];
    onShow: (id: number) => void;
    onRetry: (id: number) => void;
    onForget: (id: number) => void;
  } & ActionHandlers
> = ({ connection, reason, actions, onShow, onRetry, onForget, ...handlers }) => {
  const device = connection.recognized?.device ?? null;
  const contract = connection.recognized?.contract ?? null;
  const name = unitName(connection);
  const status = statusText(connection);
  const flash = actions.find((action) => action.kind === 'flash');
  const busy = connection.id === handlers.writing;
  return (
    <li className={cn('flex flex-col gap-2 border-b border-line px-1 py-3 last:border-b-0', connection.state === 'unplugged' && 'opacity-70')}>
      <div className="flex items-start gap-3">
        <UnitImage code={device?.hardwareVariant.code ?? null} name={device?.hardwareVariant.name ?? null} kind="icon" />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-body font-semibold text-ink">{device ? device.assetTag : 'Unknown unit'}</h3>
          <p className="truncate text-body-sm text-ink-muted">
            <span className="font-mono">{connection.unit?.nodeId ?? 'Node not read'}</span>
            {device ? `, ${device.hardwareVariant.name}` : connection.unit?.pioEnv ? `, ${connection.unit.pioEnv}` : ''}
          </p>
          <p className="text-body-sm text-ink">
            {status && <span className="font-semibold">{status}</span>}
            {contract && <span>{status ? ', ' : ''}{contract.code} ({contract.status.toLowerCase()})</span>}
          </p>
          <p className="text-caption text-ink-muted" aria-live={busy ? 'polite' : undefined}>
            {STATE_TEXT[connection.state]}
          </p>
        </div>
      </div>
      {(connection.message || reason) && (
        <p className="text-body-sm text-ink">{connection.message ?? reason}</p>
      )}
      {flash?.kind === 'flash' && (
        <p id={`flash-reason-${connection.id}`} className="text-caption text-ink-muted">
          {flash.disabledReason}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {connection.unit && connection.recognized !== null && (
          <Button size="sm" variant="ghost" aria-label={`Show ${name}`} onClick={() => onShow(connection.id)}>
            Details
          </Button>
        )}
        {actions.map((action, index) => (
          <ActionControl key={`${action.kind}-${index}`} connection={connection} action={action} {...handlers} />
        ))}
        {RETRYABLE.includes(connection.state) && (
          <Button size="sm" variant="secondary" aria-label={`Retry ${name}`} onClick={() => onRetry(connection.id)}>
            Retry
          </Button>
        )}
        {!busy && (
          <Button size="sm" variant="ghost" aria-label={`Forget ${name}`} onClick={() => onForget(connection.id)}>
            Forget
          </Button>
        )}
      </div>
    </li>
  );
};

// The quick swap's confirmation (screen 4.6 Actions, design section 11.6): the reserved unit to replace,
// the first not provisioned preselected (decided Q7 A).
const SwapDialog: React.FC<{
  dockedTag: string;
  contractCode: string;
  rows: CounterRow[];
  onConfirm: (row: CounterRow) => void;
  onClose: () => void;
}> = ({ dockedTag, contractCode, rows, onConfirm, onClose }) => {
  const [deviceId, setDeviceId] = useState(rows[0]?.deviceId ?? '');
  const row = rows.find((candidate) => candidate.deviceId === deviceId);
  return (
    <Dialog
      titleId="connector-swap-title"
      title={`Put ${dockedTag} on ${contractCode}?`}
      onClose={onClose}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!row} onClick={() => row && onConfirm(row)}>
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

// The device view of one unit (design section 11.2, REQ-EVT-38): the upright render, what the unit
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
      {flash?.kind === 'flash' && (
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

  const can = useMemo(() => ({ register: staff, operate: staff }), [staff]);

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
  };

  const viewed = viewing === null ? undefined : snapshot.connections.find((connection) => connection.id === viewing);
  const missing =
    focus?.assetTag && !snapshot.connections.some((connection) => connection.unit?.nodeNum === focus.nodeNum)
      ? focus.assetTag
      : null;
  const uplinkDevice = uplink?.recognized?.device;

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
          {snapshot.connections.length === 0 ? (
            <p className="text-body text-ink">
              No units connected. Plug a unit in with its USB cable, then choose Connect a unit.
            </p>
          ) : (
            <ul aria-labelledby={headingId} className="flex flex-col">
              {snapshot.connections.map((connection) => {
                const { actions, reason } = actionsFor(connection, context, can);
                return (
                  <UnitRow
                    key={connection.id}
                    connection={connection}
                    actions={actions}
                    reason={reason}
                    writing={snapshot.writing}
                    onAction={onAction}
                    onShow={view}
                    onRetry={(id) => registry.retry(id)}
                    onForget={(id) => void registry.forget(id)}
                  />
                );
              })}
            </ul>
          )}
        </>
      )}
      {swap && context?.kind === 'counter' && (
        <SwapDialog
          dockedTag={swap.connection.recognized?.device?.assetTag ?? unitName(swap.connection)}
          contractCode={context.contractCode}
          rows={swap.rows}
          onClose={() => setSwap(null)}
          onConfirm={(row) => {
            const target = swap.connection;
            setSwap(null);
            void context.swapIn(target.id, row);
          }}
        />
      )}
      {uplink && uplinkDevice && (
        <ConfigureUplinkDialog
          device={{
            id: uplinkDevice.id,
            assetTag: uplinkDevice.assetTag,
            nodeNum: uplinkDevice.nodeNum,
            keyVersion: uplinkDevice.keyVersion,
          }}
          onDone={() => {
            setUplink(null);
            void registry.refreshRecognition(uplink.id);
          }}
          onClose={() => setUplink(null)}
        />
      )}
    </div>
  );
};

// The panel's frame: the pushed aside from 1100 px; the drawers are placed by the shell (screen 4.6).
export const ConnectorAside: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <aside
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
