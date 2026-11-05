import React, { useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { flattenGroups, type DeviceGroup } from '../../entities/rented-device/api';
import { Button, Field, Menu, Select, Skeleton } from '../../shared/ui';
import { cn } from '../../shared/ui/cn';
import { groupTreeItemId } from './groupTreeId';
import { useMediaQuery } from '../../shared/lib/useMediaQuery';

const ALL_GROUPS = '';
const NO_GROUP = 'none';

export const GroupOptions: React.FC<{ groups: DeviceGroup[]; ungrouped?: boolean }> = ({
  groups,
  ungrouped = false,
}) => (
  <>
    <option value={ALL_GROUPS}>All groups</option>
    {ungrouped && <option value={NO_GROUP}>No group</option>}
    {flattenGroups(groups).map(({ group, depth }) => (
      <option key={group.id} value={group.id}>{`${'↳ '.repeat(depth)}${group.name}`}</option>
    ))}
  </>
);

interface TreeProps {
  groups: DeviceGroup[];
  loading: boolean;
  selected: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onEdit: (group: DeviceGroup) => void;
  onRemove: (group: DeviceGroup) => void;
}

export const GroupTree: React.FC<TreeProps> = ({
  groups,
  loading,
  selected,
  onSelect,
  onCreate,
  onEdit,
  onRemove,
}) => {
  const [focused, setFocused] = useState(ALL_GROUPS);
  const compact = useMediaQuery(
    '(max-width: 767.98px) and (min-height: 480px) and (max-height: 740px)',
  );
  const [groupsOpen, setGroupsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const flat = flattenGroups(groups);
  const order = [ALL_GROUPS, ...flat.map(({ group }) => group.id), NO_GROUP];
  const roving = order.includes(focused) ? focused : ALL_GROUPS;
  const menu = (group: DeviceGroup) => (
    <Menu
      label={`Actions for ${group.name}`}
      trigger={<MoreHorizontal aria-hidden="true" size={18} />}
      chevron={false}
      items={[
        { key: 'edit', label: 'Edit group', onSelect: () => onEdit(group) },
        {
          key: 'remove',
          label: 'Remove group',
          destructive: true,
          onSelect: () => onRemove(group),
        },
      ]}
    />
  );
  const onKey = (event: React.KeyboardEvent<HTMLElement>, id: string) => {
    if (event.target !== event.currentTarget) return;
    const at = order.indexOf(id);
    const group = flat.find((entry) => entry.group.id === id)?.group;
    let next: string | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = order[at + 1];
        break;
      case 'ArrowUp':
        next = order[at - 1];
        break;
      case 'ArrowLeft':
        next = group ? (group.parentId ?? ALL_GROUPS) : undefined;
        break;
      case 'ArrowRight':
        next = group?.children[0]?.id;
        break;
      case 'Home':
        next = ALL_GROUPS;
        break;
      case 'End':
        next = NO_GROUP;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onSelect(id);
        return;
      default:
        return;
    }
    event.preventDefault();
    if (next !== undefined) document.getElementById(groupTreeItemId(next))?.focus();
  };
  const item = (id: string, label: string, group?: DeviceGroup): React.ReactElement => (
    <li
      key={id}
      id={groupTreeItemId(id)}
      role="treeitem"
      aria-selected={selected === id}
      aria-expanded={group?.children.length ? true : undefined}
      aria-labelledby={`${groupTreeItemId(id)}-label`}
      tabIndex={roving === id ? 0 : -1}
      onFocus={(event) => {
        if (event.target === event.currentTarget) setFocused(id);
      }}
      onKeyDown={(event) => onKey(event, id)}
      className="rounded-control focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
    >
      <div className={cn('flex items-center rounded-control', selected === id && 'bg-chrome')}>
        <button
          id={`${groupTreeItemId(id)}-label`}
          aria-label={
            group
              ? [
                  label,
                  `${group.deviceCount} ${group.deviceCount === 1 ? 'device' : 'devices'}`,
                  group.label,
                  group.startsOn ? `From ${group.startsOn}` : null,
                  group.startsOn && group.endsOn ? '·' : null,
                  group.endsOn ? `Until ${group.endsOn}` : null,
                ]
                  .filter(Boolean)
                  .join(' ')
              : label
          }
          type="button"
          tabIndex={-1}
          onClick={() => {
            document.getElementById(groupTreeItemId(id))?.focus();
            onSelect(id);
          }}
          className="min-h-11 min-w-0 flex-1 px-2 text-left text-sm font-medium"
        >
          <span className="break-words">{label}</span>
          {group && (
            <>
              {' '}
              <span className="ml-2 text-ink-muted">
                {group.deviceCount}
                <span className="sr-only"> {group.deviceCount === 1 ? 'device' : 'devices'}</span>
              </span>
            </>
          )}
          {group?.label && <span className="block text-xs text-ink-muted">{group.label}</span>}
          {group && (group.startsOn || group.endsOn) && (
            <span className="block text-xs text-ink-muted">
              {group.startsOn ? `From ${group.startsOn}` : ''}
              {group.startsOn && group.endsOn ? ' · ' : ''}
              {group.endsOn ? `Until ${group.endsOn}` : ''}
            </span>
          )}
        </button>
        {group && menu(group)}
      </div>
      {!!group?.children.length && (
        <ul role="group" className="ml-3 border-l border-line pl-2">
          {group.children.map((child) => item(child.id, child.name, child))}
        </ul>
      )}
    </li>
  );

  return (
    <aside
      aria-label="Device groups"
      onKeyDown={(event) => {
        if (compact && groupsOpen && event.key === 'Escape') {
          event.preventDefault();
          setGroupsOpen(false);
          toggleRef.current?.focus();
        }
      }}
      className={cn(
        'relative flex min-h-0 max-h-[40dvh] flex-col gap-3 rounded-panel border border-line bg-surface md:max-h-none [@media(max-height:479.98px)]:max-h-none',
        compact ? 'z-sidebar overflow-visible p-2' : 'overflow-hidden p-3',
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2">
        {compact ? (
          <Button
            ref={toggleRef}
            className="min-w-0 flex-1"
            aria-expanded={groupsOpen}
            aria-controls="rented-group-controls"
            onClick={() => setGroupsOpen(!groupsOpen)}
          >
            <span className="truncate">
              Groups:{' '}
              {selected === NO_GROUP
                ? 'No group'
                : (flat.find(({ group }) => group.id === selected)?.group.name ?? 'All groups')}
            </span>
          </Button>
        ) : (
          <h2 className="text-body-lg font-semibold">Groups</h2>
        )}
        <Button id="new-rented-group" onClick={onCreate}>
          New group
        </Button>
      </div>
      {(!compact || groupsOpen) &&
        (loading ? (
          <div aria-label="Loading groups" className="space-y-2">
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
            <Skeleton className="h-9" />
          </div>
        ) : (
          <div
            id="rented-group-controls"
            className={cn(
              'min-h-0 overflow-y-auto',
              compact
                ? 'absolute left-0 right-0 top-full z-raised mt-1 max-h-[40dvh] rounded-panel border border-line bg-surface p-3 shadow-glass'
                : 'relative',
            )}
          >
            {groups.length === 0 && (
              <p className="text-sm text-ink-muted">
                No groups yet. Create one to sort your devices.
              </p>
            )}
            <div className="md:hidden">
              <Field id="phone-device-group" label="Group">
                <Select
                  id="phone-device-group"
                  value={selected}
                  onChange={(event) => {
                    onSelect(event.target.value);
                    if (compact) {
                      setGroupsOpen(false);
                      toggleRef.current?.focus();
                    }
                  }}
                >
                  <GroupOptions groups={groups} ungrouped />
                </Select>
              </Field>
              {flat.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer py-2 text-sm font-medium">
                    Manage groups
                  </summary>
                  <ul>
                    {flat.map(({ group, depth }) => (
                      <li key={group.id} className="flex items-center justify-between gap-2">
                        <span>{`${'↳ '.repeat(depth)}${group.name}`}</span>
                        {menu(group)}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <ul role="tree" aria-label="Filter by device group" className="hidden md:block">
              {item(ALL_GROUPS, 'All groups')}
              {groups.map((group) => item(group.id, group.name, group))}
              {item(NO_GROUP, 'No group')}
            </ul>
          </div>
        ))}
    </aside>
  );
};
