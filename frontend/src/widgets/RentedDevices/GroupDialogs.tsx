import React, { useId, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  assignDevices,
  flattenGroups,
  removeDeviceGroup,
  saveDeviceGroup,
  type DeviceGroup,
  type GroupFields,
} from '../../entities/rented-device/api';
import { ApiError } from '../../shared/api/apiClient';
import {
  Alert,
  Button,
  ConfirmDialog,
  Dialog,
  Field,
  Input,
  Select,
  Textarea,
} from '../../shared/ui';
import { messageOf } from '../../shared/ui/errors';

interface GroupFormProps {
  groups: DeviceGroup[];
  maxDepth: number;
  group?: DeviceGroup;
  onClose: () => void;
  onSaved: () => void;
  onReload: () => void;
}

export const GroupForm: React.FC<GroupFormProps> = ({
  groups,
  maxDepth,
  group,
  onClose,
  onSaved,
  onReload,
}) => {
  const id = useId();
  const [fields, setFields] = useState<GroupFields>({
    name: group?.name ?? '',
    parentId: group?.parentId ?? null,
    label: group?.label ?? null,
    startsOn: group?.startsOn ?? null,
    endsOn: group?.endsOn ?? null,
    areaNote: group?.areaNote ?? null,
  });
  const [localError, setLocalError] = useState<{ name?: string; endsOn?: string }>({});
  const save = useMutation({
    mutationFn: (values: GroupFields) => saveDeviceGroup(values, group),
    onSuccess: onSaved,
  });
  const failure = save.error instanceof ApiError ? save.error.errorCode : null;
  const nameError =
    localError.name ??
    (failure === 'CONFLICT_UNIQUE' ? 'A group with this name already exists here.' : undefined);
  const endError =
    localError.endsOn ??
    (failure === 'VALIDATION_FAILED' && /end after the start/i.test(messageOf(save.error))
      ? 'Choose an end after the start.'
      : undefined);
  const descendants = group ? flattenGroups(group.children, 1) : [];
  const excluded = new Set([group?.id, ...descendants.map(({ group: child }) => child.id)]);
  const height = Math.max(0, ...descendants.map(({ depth }) => depth));
  const options = flattenGroups(groups).filter(
    ({ group: parent, depth }) =>
      parent.id === group?.parentId || (!excluded.has(parent.id) && depth + 1 + height <= maxDepth),
  );
  const set = <K extends keyof GroupFields>(key: K, value: GroupFields[K]) => {
    setFields((current) => ({ ...current, [key]: value }));
    setLocalError({});
    if (save.error) save.reset();
  };
  const close = () => {
    if (!save.isPending) onClose();
  };

  return (
    <Dialog
      titleId={`${id}-title`}
      title={group ? `Edit ${group.name}` : 'New group'}
      onClose={close}
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={save.isPending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={id} loading={save.isPending}>
            Save group
          </Button>
        </>
      }
    >
      <form
        id={id}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          const next: typeof localError = {};
          const name = fields.name.trim();
          if (!name) next.name = 'Name is required.';
          if (fields.startsOn && fields.endsOn && fields.endsOn < fields.startsOn)
            next.endsOn = 'Choose an end after the start.';
          setLocalError(next);
          if (Object.keys(next).length === 0)
            save.mutate({
              ...fields,
              name,
              label: fields.label?.trim() || null,
              areaNote: fields.areaNote?.trim() || null,
            });
        }}
      >
        {save.error && !nameError && !endError && (
          <Alert
            tone="error"
            action={
              failure === 'STALE_VERSION' ? <Button onClick={onReload}>Reload</Button> : undefined
            }
          >
            {failure === 'STALE_VERSION'
              ? 'Someone else changed this group. Reload to see the latest.'
              : messageOf(save.error)}
          </Alert>
        )}
        <Field id={`${id}-name`} label="Name" error={nameError}>
          <Input
            id={`${id}-name`}
            value={fields.name}
            maxLength={80}
            onChange={(event) => set('name', event.target.value)}
          />
        </Field>
        <Field id={`${id}-parent`} label="Parent group">
          <Select
            id={`${id}-parent`}
            value={fields.parentId ?? ''}
            onChange={(event) => set('parentId', event.target.value || null)}
          >
            <option value="" disabled={!!group?.parentId && height > maxDepth}>
              None (top level)
            </option>
            {options.map(({ group: parent, depth }) => (
              <option
                key={parent.id}
                value={parent.id}
              >{`${'↳ '.repeat(depth)}${parent.name}`}</option>
            ))}
          </Select>
        </Field>
        <Field id={`${id}-label`} label="Label">
          <Input
            id={`${id}-label`}
            maxLength={80}
            value={fields.label ?? ''}
            onChange={(event) => set('label', event.target.value || null)}
          />
        </Field>
        <details
          className="space-y-3 rounded-control border border-line p-3"
          open={endError ? true : undefined}
        >
          <summary className="cursor-pointer font-medium">Details</summary>
          <Field id={`${id}-start`} label="Start date">
            <Input
              id={`${id}-start`}
              type="date"
              value={fields.startsOn ?? ''}
              onChange={(event) => set('startsOn', event.target.value || null)}
            />
          </Field>
          <Field id={`${id}-end`} label="End date" error={endError}>
            <Input
              id={`${id}-end`}
              type="date"
              value={fields.endsOn ?? ''}
              onChange={(event) => set('endsOn', event.target.value || null)}
            />
          </Field>
          <Field id={`${id}-area`} label="Area note">
            <Textarea
              id={`${id}-area`}
              maxLength={500}
              rows={3}
              value={fields.areaNote ?? ''}
              onChange={(event) => set('areaNote', event.target.value || null)}
            />
          </Field>
        </details>
      </form>
    </Dialog>
  );
};

export const RemoveGroupDialog: React.FC<{
  group: DeviceGroup;
  onClose: () => void;
  onRemoved: () => void;
}> = ({ group, onClose, onRemoved }) => {
  const remove = useMutation({
    mutationFn: () => removeDeviceGroup(group.id),
    onSuccess: onRemoved,
  });
  const descendants = flattenGroups(group.children);
  const devices =
    group.deviceCount + descendants.reduce((sum, item) => sum + item.group.deviceCount, 0);
  return (
    <ConfirmDialog
      titleId="remove-rented-group"
      title={`Remove ${group.name}?`}
      description={`This also removes ${descendants.length} subgroups and leaves ${devices} devices ungrouped.`}
      confirmLabel="Remove group"
      pending={remove.isPending}
      onConfirm={() => remove.mutate()}
      onCancel={() => {
        if (!remove.isPending) onClose();
      }}
      error={remove.error ? messageOf(remove.error) : undefined}
      destructive
      irreversible
    />
  );
};

export const AssignGroupDialog: React.FC<{
  groups: DeviceGroup[];
  deviceIds: string[];
  onClose: () => void;
  onAssigned: (message: string) => void;
  onDeviceNotHeld: () => void;
}> = ({ groups, deviceIds, onClose, onAssigned, onDeviceNotHeld }) => {
  const id = useId();
  const [groupId, setGroupId] = useState('');
  const flat = flattenGroups(groups);
  const assign = useMutation({
    mutationFn: () => assignDevices(groupId, deviceIds),
    onSuccess: ({ assigned }) => {
      const name = flat.find(({ group }) => group.id === groupId)?.group.name ?? 'the group';
      onAssigned(
        assigned.length === 0
          ? 'The selected devices already belong to this group.'
          : `${assigned.length} ${assigned.length === 1 ? 'device' : 'devices'} moved to ${name}.`,
      );
    },
    onError: (failure) => {
      if (failure instanceof ApiError && failure.errorCode === 'DEVICE_NOT_HELD') onDeviceNotHeld();
    },
  });
  const close = () => {
    if (!assign.isPending) onClose();
  };
  return (
    <Dialog
      titleId={`${id}-title`}
      title="Assign to group"
      onClose={close}
      description={`Choose the group for ${deviceIds.length} selected ${deviceIds.length === 1 ? 'device' : 'devices'}.`}
      footer={
        <>
          <Button onClick={close} variant="ghost" disabled={assign.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={id}
            variant="primary"
            loading={assign.isPending}
            disabled={!groupId}
          >
            Assign devices
          </Button>
        </>
      }
    >
      <form
        id={id}
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (groupId) assign.mutate();
        }}
      >
        {assign.error && <Alert tone="error">{messageOf(assign.error)}</Alert>}
        <Field id={`${id}-group`} label="Group">
          <Select
            id={`${id}-group`}
            value={groupId}
            onChange={(event) => setGroupId(event.target.value)}
          >
            <option value="">Choose a group</option>
            {flat.map(({ group, depth }) => (
              <option
                key={group.id}
                value={group.id}
              >{`${'↳ '.repeat(depth)}${group.name}`}</option>
            ))}
          </Select>
        </Field>
      </form>
    </Dialog>
  );
};
