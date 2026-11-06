import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeftRight,
  Download,
  ExternalLink,
  KeyRound,
  LayoutDashboard,
  Plug,
  Power,
  Radio,
  RotateCw,
  Square,
  Trash2,
  UserPlus,
} from 'lucide-react';
import {
  CollectionView,
  type CollectionAction,
  type CollectionField,
} from '../../../shared/ui/collection-view';
import { Skeleton } from '../../../shared/ui/Skeleton';
import { DEVICE_STATUS, type DeviceStatus } from '../../../shared/ui/status';
import type { Connection, RegistrySnapshot } from '../model/ConnectorRegistry';
import type { UnitAction, UnitActions } from '../model/actionsFor';
import { RETRYABLE, STATE_TEXT, unitName } from '../model/text';
import { UnitImage } from './UnitImage';

// The rows of the device connector panel through the shared CollectionView (chapter 06 §9, D-096, devices
// design section 12.2): the List view, one row per connected unit, its actions as icon buttons with the
// §9.5 tooltip, and no command bar while two or fewer units are connected (§9.3). The hub's own device
// view replaces the details pane, so the module's pane is off and Show details opens the device view.

const LOCKED = 'Another unit is being written.';

interface Props {
  label: string;
  snapshot: RegistrySnapshot;
  actionsOf: (connection: Connection) => UnitActions;
  onAction: (connection: Connection, action: UnitAction) => void;
  onShow: (connectionId: number) => void;
  onRetry: (connectionId: number) => void;
  onForget: (connection: Connection) => void;
  onReconnect: () => void;
  onStopReconnect: () => void;
  // Opens the device hub on the unit, and starts Update firmware or Reboot there (design section 12.14).
  onOpenHub?: (connection: Connection, action?: 'reboot' | 'flash') => void;
}

// Read and recognition still running: nothing about the unit is known yet.
const reading = (connection: Connection): boolean =>
  !connection.recognized && (connection.state === 'reading' || connection.state === 'looking-up');

const statusText = (connection: Connection): string | null => {
  if (!connection.unit || !connection.recognized) return null;
  const device = connection.recognized.device;
  if (!device) return 'Not registered';
  return DEVICE_STATUS[device.status as DeviceStatus]?.label ?? device.status;
};

const find = <K extends UnitAction['kind']>(actions: UnitAction[], kind: K) =>
  actions.find((action): action is Extract<UnitAction, { kind: K }> => action.kind === kind);

export const ConnectorList: React.FC<Props> = ({
  label,
  snapshot,
  actionsOf,
  onAction,
  onShow,
  onRetry,
  onForget,
  onReconnect,
  onStopReconnect,
  onOpenHub,
}) => {
  const navigate = useNavigate();
  const writing = snapshot.writing;
  const byId = useMemo(
    () => new Map(snapshot.connections.map((connection) => [connection.id, actionsOf(connection)])),
    [snapshot.connections, actionsOf],
  );
  const actionsFor = (connection: Connection) =>
    byId.get(connection.id) ?? { actions: [], reason: null };
  // A write on another unit makes this unit's writes unavailable, with the reason (REQ-STA-06).
  const lockedOut = (connection: Connection) =>
    writing !== null && writing !== connection.id ? LOCKED : undefined;

  const fields: CollectionField<Connection>[] = [
    {
      key: 'unit',
      label: 'Unit',
      compact: true,
      text: (connection) =>
        `${connection.unit?.nodeId ?? ''} ${connection.recognized?.device?.hardwareVariant.name ?? ''}`,
      render: (connection) =>
        reading(connection) && !connection.unit ? (
          <Skeleton className="h-3.5 w-32" />
        ) : (
          <span className="text-ink-muted">
            <span className="font-mono">{connection.unit?.nodeId ?? 'Node not read'}</span>
            {connection.recognized?.device
              ? `, ${connection.recognized.device.hardwareVariant.name}`
              : connection.unit?.pioEnv
                ? `, ${connection.unit.pioEnv}`
                : ''}
          </span>
        ),
    },
    {
      key: 'status',
      label: 'Status',
      compact: true,
      text: (connection) => statusText(connection) ?? '',
      render: (connection) => {
        const status = statusText(connection);
        const contract = connection.recognized?.contract;
        return (
          <span>
            {status && <span className="font-semibold">{status}</span>}
            {contract && (
              <span>
                {status ? ', ' : ''}
                {contract.code} ({contract.status.toLowerCase()})
              </span>
            )}
          </span>
        );
      },
    },
    {
      key: 'connection',
      label: 'Connection',
      compact: true,
      text: (connection) => STATE_TEXT[connection.state],
      render: (connection) => {
        const { actions, reason } = actionsFor(connection);
        const flash = find(actions, 'flash');
        const notes = [
          connection.message ?? reason,
          flash?.disabledReason ?? null,
          lockedOut(connection) &&
          actions.some((action) => action.kind !== 'link' && action.kind !== 'register')
            ? LOCKED
            : null,
        ].filter((note): note is string => Boolean(note));
        return (
          <span className="flex flex-col">
            <span className="text-caption text-ink-muted">{STATE_TEXT[connection.state]}</span>
            {/* Reasons stay text, never only a tooltip (chapter 06 §9.8). */}
            {notes.map((note) => (
              <span key={note} className="text-body-sm text-ink">
                {note}
              </span>
            ))}
          </span>
        );
      },
    },
  ];

  const kindAction = (
    key: string,
    actionLabel: string,
    icon: React.ReactNode,
    kind: UnitAction['kind'],
    writes: boolean,
  ): CollectionAction<Connection> => ({
    key,
    label: actionLabel,
    icon,
    allowed: (connection) => actionsFor(connection).actions.some((action) => action.kind === kind),
    unavailableReason: (connection) => {
      const action = actionsFor(connection).actions.find((candidate) => candidate.kind === kind);
      if (action?.kind === 'flash' && action.disabledReason) return action.disabledReason;
      return writes ? lockedOut(connection) : undefined;
    },
    onSelect: (connection) => {
      const action = actionsFor(connection).actions.find((candidate) => candidate.kind === kind);
      if (action) onAction(connection, action);
    },
  });

  const linkAction = (actionLabel: string): CollectionAction<Connection> => ({
    key: `link-${actionLabel}`,
    label: actionLabel,
    icon: <ExternalLink />,
    allowed: (connection) =>
      actionsFor(connection).actions.some(
        (action) => action.kind === 'link' && action.label === actionLabel,
      ),
    onSelect: (connection) => {
      const action = actionsFor(connection).actions.find(
        (candidate) => candidate.kind === 'link' && candidate.label === actionLabel,
      );
      if (action?.kind === 'link') navigate(action.to);
    },
  });

  // Show details is CollectionView's own slot at the inline end (chapter 06 §11.4, onShowDetails); a unit
  // still being read opens its device view with the fields it has, marked Not read.
  // The card footer's main actions (design section 12.14, REQ-EVT-50, chapter 06 §11.4): Open in device hub, which
  // shares its slot with Register for an unknown unit, then Update firmware and Reboot, both run in the hub through
  // its dialogs. They keep their slots, disabled with the reason, while the unit cannot take them.
  const ready = (connection: Connection) => connection.state === 'ready' && connection.unit !== null;
  const hubActions: CollectionAction<Connection>[] = onOpenHub
    ? [
        {
          key: 'hub',
          slot: 'main',
          inline: true,
          label: 'Open in device hub',
          icon: <LayoutDashboard />,
          allowed: (connection) => Boolean(connection.recognized?.device) || !connection.recognized,
          unavailableReason: (connection) => (ready(connection) ? undefined : STATE_TEXT[connection.state]),
          onSelect: (connection) => onOpenHub(connection),
        },
        {
          ...kindAction('register', 'Register', <UserPlus />, 'register', false),
          slot: 'main',
          inline: true,
          accessibleName: (connection) => `Register ${unitName(connection)}`,
        },
        {
          key: 'hub-flash',
          inline: true,
          label: 'Update firmware',
          icon: <Download />,
          allowed: (connection) => Boolean(connection.recognized?.device),
          unavailableReason: (connection) => {
            const flash = find(actionsFor(connection).actions, 'flash');
            if (!flash) return ready(connection) ? 'Register this unit first.' : STATE_TEXT[connection.state];
            return flash.disabledReason ?? lockedOut(connection);
          },
          onSelect: (connection) => onOpenHub(connection, 'flash'),
        },
        {
          key: 'hub-reboot',
          inline: true,
          label: 'Reboot',
          icon: <Power />,
          unavailableReason: (connection) => (ready(connection) ? lockedOut(connection) : STATE_TEXT[connection.state]),
          onSelect: (connection) => onOpenHub(connection, 'reboot'),
        },
      ]
    : [];
  const itemActions: CollectionAction<Connection>[] = [
    ...hubActions,
    ...(onOpenHub ? [] : [kindAction('register', 'New device: register it?', <UserPlus />, 'register', false)]),
    kindAction('provision', 'Provision', <KeyRound />, 'provision', true),
    kindAction('swap', 'Put on this contract', <ArrowLeftRight />, 'swap', true),
    kindAction('uplink', 'Configure uplink', <Radio />, 'uplink', true),
    ...(onOpenHub ? [] : [kindAction('flash', 'Update firmware', <Download />, 'flash', true)]),
    linkAction('Record intake check'),
    linkAction('Open its counter'),
    linkAction('Open device page'),
    {
      key: 'reconnect',
      label: 'Reconnect',
      icon: <Plug />,
      allowed: (connection) =>
        snapshot.reconnectFor === connection.id && connection.state === 'reconnect',
      onSelect: () => onReconnect(),
    },
    {
      key: 'stop',
      label: 'Stop waiting for',
      icon: <Square />,
      allowed: (connection) =>
        snapshot.reconnectFor === connection.id && connection.state === 'reconnect',
      onSelect: () => onStopReconnect(),
    },
    {
      key: 'retry',
      label: 'Retry',
      icon: <RotateCw />,
      allowed: (connection) => RETRYABLE.includes(connection.state),
      onSelect: (connection) => onRetry(connection.id),
    },
    {
      key: 'forget',
      label: 'Forget',
      icon: <Trash2 />,
      destructive: true,
      allowed: (connection) => connection.id !== writing,
      onSelect: (connection) => onForget(connection),
    },
  ];

  return (
    <CollectionView<Connection>
      label={label}
      items={[...snapshot.connections]}
      itemId={(connection) => String(connection.id)}
      itemName={unitName}
      // The card's tile holds the unit's icon render and its heading the asset tag (chapter 06 §9.2). A unit
      // still being read or checked shows a skeleton in their place (screen 4.6, States); the connection
      // field says which step it is on.
      cardImage={(connection) =>
        reading(connection) ? (
          <Skeleton className="h-12 w-12" />
        ) : (
          <UnitImage
            code={connection.recognized?.device?.hardwareVariant.code ?? null}
            name={connection.recognized?.device?.hardwareVariant.name ?? null}
            kind="icon"
          />
        )
      }
      itemTitle={(connection) =>
        reading(connection) ? (
          <>
            <span className="sr-only">Unit being read</span>
            <Skeleton className="h-4 w-24" />
          </>
        ) : (
          <span className="block truncate text-body text-ink">
            {connection.recognized?.device?.assetTag ?? 'Unknown unit'}
          </span>
        )
      }
      fields={fields}
      noun={{ one: 'unit', other: 'units' }}
      itemActions={itemActions}
      onShowDetails={(connection) => onShow(connection.id)}
      // The panel is narrow, so the units show as Large cards, the view a collection takes below 600 px
      // (chapter 06 §9); the List view this used is gone from CollectionView.
      defaultView="largeCards"
      details={false}
      search={{ label: 'Search connected units' }}
      emptyState={{
        title: 'No units connected.',
        description: 'Plug a unit in with its USB cable, then choose Connect a unit.',
      }}
    />
  );
};
