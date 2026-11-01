import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import { ME_KEY } from '../features/account-menu/api';
import {
  roleKeys,
  saveRolePermissions,
  usePermissions,
  useRoles,
  type Permission,
  type Role,
} from '../entities/role/api';
import {
  INHERITS,
  catalogFor,
  diffOf,
  diffSentence,
  groupBySubject,
  isDirty,
  roleTitle,
  scopeText,
} from '../entities/role/model';
import { ApiError } from '../shared/api/apiClient';
import {
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Dialog,
  PageHeader,
  Select,
  Skeleton,
  useToast,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { messageOf } from '../shared/ui/errors';

// Draft of the selected role: the keys ticked now. Null while the panel shows what is saved.
interface Draft {
  roleId: string;
  keys: Set<string>;
}

const UNKNOWN = /^Unknown permission: (.+)\.$/;

// The role list on a wide screen: roving focus, Up and Down move, the selected role is the tab stop.
const RoleList: React.FC<{
  roles: Role[];
  selectedId: string;
  onSelect: (id: string) => void;
}> = ({ roles, selectedId, onSelect }) => {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const move = (event: React.KeyboardEvent, index: number) => {
    let next = -1;
    if (event.key === 'ArrowDown') next = (index + 1) % roles.length;
    else if (event.key === 'ArrowUp') next = (index - 1 + roles.length) % roles.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = roles.length - 1;
    if (next < 0) return;
    event.preventDefault();
    refs.current[roles[next].id]?.focus();
  };
  return (
    <div role="listbox" aria-label="Roles" className="hidden flex-col gap-1 md:flex">
      {roles.map((role, index) => {
        const selected = role.id === selectedId;
        return (
          <button
            key={role.id}
            ref={(node) => {
              refs.current[role.id] = node;
            }}
            type="button"
            role="option"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onSelect(role.id)}
            onKeyDown={(event) => move(event, index)}
            className={`flex min-h-11 flex-col rounded-control border px-3 py-2 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus ${
              selected ? 'border-brand bg-chrome' : 'border-line hover:bg-sunken'
            }`}
          >
            <span className="font-mono text-body font-semibold text-ink">{role.key}</span>
            <span className="text-body-sm text-ink-muted">
              {role.accountType === 'TREKLINK' ? 'TrekLink' : 'Organization'},{' '}
              {role.permissionKeys.length}{' '}
              {role.permissionKeys.length === 1 ? 'permission' : 'permissions'}
              {role.isSystem ? ', System role' : ''}
            </span>
          </button>
        );
      })}
    </div>
  );
};

// `/t/admin/roles`, screen 7.2 (auth api-design 15, 16 and 18, UC-10, FR-AUTH-06, FR-AUTH-10): the four
// roles and the permissions each holds, edited as a draft and saved as the full list. TrekLink Admin only.
export const RolesPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const roles = useRoles();
  const catalog = usePermissions();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  // The role the user asked for while a draft is open: the discard dialog decides.
  const [switchTo, setSwitchTo] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [badKey, setBadKey] = useState<string | null>(null);
  const [lockout, setLockout] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);

  const list = roles.data;
  const role = list?.find((item) => item.id === (selectedId ?? list[0]?.id));
  const roleId = role?.id;
  const loaded = role?.permissionKeys ?? [];
  const keys: ReadonlySet<string> = draft && draft.roleId === roleId ? draft.keys : new Set(loaded);
  const diff = diffOf(loaded, keys);
  const dirty = isDirty(diff);

  // A closed or reloaded tab would lose the draft: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const failure = roles.error ?? catalog.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const select = (id: string) => {
    if (id === roleId) return;
    if (dirty) {
      setSwitchTo(id);
      return;
    }
    go(id);
  };
  const go = (id: string) => {
    setSelectedId(id);
    setDraft(null);
    setBanner(null);
    setBadKey(null);
    setSwitchTo(null);
    // The panel heading takes focus, so a screen reader hears the role it now shows.
    setTimeout(() => headingRef.current?.focus(), 0);
  };

  const toggle = (permission: Permission) => {
    if (!role) return;
    const next = new Set(keys);
    if (next.has(permission.key)) next.delete(permission.key);
    else next.add(permission.key);
    setDraft({ roleId: role.id, keys: next });
    setBadKey(null);
  };

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.roles });
    void queryClient.invalidateQueries({ queryKey: roleKeys.permissions });
  };

  const save = async () => {
    if (!role) return;
    setPending(true);
    setBanner(null);
    try {
      await saveRolePermissions(role.id, [...keys].sort());
      setConfirming(false);
      setPending(false);
      setDraft(null);
      showToast('Permissions updated');
      void queryClient.invalidateQueries({ queryKey: roleKeys.roles });
      // A role change applies on the next request (REQ-UBI-08), so the signed-in Admin reads themselves again.
      if (user?.roles.includes(role.key)) void queryClient.invalidateQueries({ queryKey: ME_KEY });
      setTimeout(() => saveRef.current?.focus(), 0);
    } catch (caught) {
      setPending(false);
      setConfirming(false);
      if (caught instanceof ApiError && caught.errorCode === 'ADMIN_LOCKOUT') {
        setLockout(caught.message);
      } else if (caught instanceof ApiError && caught.errorCode === 'NOT_FOUND') {
        setDraft(null);
        showToast('Role not found.');
        reload();
      } else if (caught instanceof ApiError && caught.errorCode === 'UNKNOWN_PERMISSION') {
        // The catalog changed under the client: mark the key, keep the draft, reload what is shown.
        setBadKey(UNKNOWN.exec(caught.message)?.[1] ?? null);
        setBanner(caught.message);
        reload();
      } else {
        setBanner(
          caught instanceof ApiError &&
            ['PERMISSION_SCOPE_MISMATCH', 'VALIDATION_FAILED'].includes(caught.errorCode)
            ? caught.message
            : messageOf(caught),
        );
      }
    }
  };

  if (roles.isPending || catalog.isPending) {
    return (
      <section aria-labelledby="roles-title" className="flex flex-col gap-4">
        <PageHeader id="roles-title" title="Roles and permissions" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (failure || !list || !catalog.data || !role) {
    return (
      <section aria-labelledby="roles-title" className="flex flex-col gap-4">
        <PageHeader id="roles-title" title="Roles and permissions" />
        <ErrorState
          error={failure}
          onRetry={() => {
            void roles.refetch();
            void catalog.refetch();
          }}
        />
      </section>
    );
  }

  const groups = groupBySubject(catalogFor(role, catalog.data));
  const inherited = INHERITS[role.key];
  const adminLocked = (permission: Permission) => role.key === 'ADMIN' && permission.protected;

  return (
    <section aria-labelledby="roles-title" className="flex flex-col gap-4">
      <PageHeader
        id="roles-title"
        title="Roles and permissions"
        description="What each role may do. A change applies to its holders on their next request."
      />

      <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
        <div>
          <div className="md:hidden">
            <label
              htmlFor="roles-select"
              className="mb-1.5 block text-body-sm font-semibold text-ink"
            >
              Role
            </label>
            <Select
              id="roles-select"
              value={role.id}
              onChange={(event) => select(event.target.value)}
            >
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key}
                </option>
              ))}
            </Select>
          </div>
          <RoleList roles={list} selectedId={role.id} onSelect={select} />
        </div>

        <Card aria-labelledby="role-panel-title">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2
                id="role-panel-title"
                ref={headingRef}
                tabIndex={-1}
                className="text-title text-ink outline-none"
              >
                {role.key}
              </h2>
              <p className="flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
                {roleTitle(role.key)},{' '}
                {role.accountType === 'TREKLINK' ? 'TrekLink' : 'Organization'}
                {role.isSystem && <Badge>System role</Badge>}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={!dirty || pending} onClick={() => setDraft(null)}>
                Discard draft
              </Button>
              <Button
                ref={saveRef}
                variant="primary"
                loading={pending}
                disabled={!dirty}
                onClick={() => setConfirming(true)}
              >
                Save permissions
              </Button>
            </div>
          </div>

          {banner && (
            <Alert tone="error" className="mb-4">
              {banner}
            </Alert>
          )}
          {inherited && (
            <p className="mb-4 text-body-sm text-ink-muted">
              {role.key} also holds every permission of {inherited}. Those are not listed below.
            </p>
          )}
          {keys.size === 0 && (
            <p className="mb-4 text-body text-ink-muted">This role holds no permissions.</p>
          )}

          <div className="flex flex-col gap-4">
            {groups.map(([subject, permissions]) => (
              <fieldset key={subject} className="m-0 min-w-0 border-0 p-0">
                <legend className="mb-1 text-body font-semibold text-ink">{subject}</legend>
                {permissions.map((permission) => {
                  const locked = adminLocked(permission);
                  return (
                    <Checkbox
                      key={permission.key}
                      label={permission.key}
                      description={`${scopeText(permission)}. ${permission.description}${locked ? ' Required for Admin.' : ''}${
                        badKey === permission.key ? ' This permission no longer exists.' : ''
                      }`}
                      checked={locked || keys.has(permission.key)}
                      disabled={locked}
                      aria-invalid={badKey === permission.key || undefined}
                      onChange={() => toggle(permission)}
                    />
                  );
                })}
              </fieldset>
            ))}
          </div>
        </Card>
      </div>

      {confirming && (
        <Dialog
          titleId="roles-confirm-title"
          title={diffSentence(role.key, diff)}
          description="Holders are affected on their next request."
          onClose={() => setConfirming(false)}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)} disabled={pending}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} onClick={() => void save()}>
                Save permissions
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-2 text-body">
            {diff.removed.length > 0 && (
              <p>
                <span className="font-semibold">Remove:</span> {diff.removed.join(', ')}
              </p>
            )}
            {diff.added.length > 0 && (
              <p>
                <span className="font-semibold">Add:</span> {diff.added.join(', ')}
              </p>
            )}
          </div>
        </Dialog>
      )}

      {switchTo && (
        <Dialog
          titleId="roles-discard-title"
          title="Discard your changes?"
          onClose={() => setSwitchTo(null)}
          size="sm"
          footer={
            <>
              <Button variant="ghost" onClick={() => setSwitchTo(null)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={() => go(switchTo)}>
                Discard changes
              </Button>
            </>
          }
        >
          <p className="text-body text-ink-muted">You changed {role.key} and have not saved it.</p>
        </Dialog>
      )}

      {lockout && (
        <Dialog
          titleId="roles-lockout-title"
          title="Admins must keep role management"
          onClose={() => setLockout(null)}
          size="sm"
          footer={
            <Button variant="primary" onClick={() => setLockout(null)}>
              OK
            </Button>
          }
        >
          <p className="text-body text-ink-muted">{lockout}</p>
        </Dialog>
      )}
    </section>
  );
};
