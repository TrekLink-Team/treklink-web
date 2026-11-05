import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageScrollBody } from '../shared/ui/PageChrome';
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
  catalogFor,
  cellOf,
  changeSummary,
  changedRoles,
  confirmTitle,
  groupBySubject,
  isChanged,
  keysOf,
  pruned,
  roleTitle,
  scopeText,
  sortRoles,
  toggled,
  type Drafts,
} from '../entities/role/model';
import { ApiError } from '../shared/api/apiClient';
import { useMediaQuery } from '../shared/lib/useMediaQuery';
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
import { RoleGrid } from '../widgets/RoleGrid/RoleGrid';

const UNKNOWN = /^Unknown permission: (.+)\.$/;

interface Failure {
  role: Role;
  message: string;
}

// One role at a time, for a screen under 768 px: the same draft and the same cell states as the grid.
const RolePanel: React.FC<{
  role: Role;
  roles: Role[];
  catalog: Permission[];
  drafts: Drafts;
  badKey: string | null;
  onToggle: (role: Role, permission: Permission) => void;
}> = ({ role, roles, catalog, drafts, badKey, onToggle }) => {
  const groups = groupBySubject(catalogFor(role, catalog));
  const keys = keysOf(role, drafts);
  return (
    <Card aria-labelledby="role-panel-title">
      <h2 id="role-panel-title" className="text-title text-ink">
        {role.key}
      </h2>
      <p className="mb-4 flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
        {roleTitle(role.key)}, {role.accountType === 'TREKLINK' ? 'TrekLink' : 'Organization'}
        {role.isSystem && <Badge>System role</Badge>}
      </p>
      {keys.size === 0 && (
        <p className="mb-4 text-body text-ink-muted">This role holds no permissions.</p>
      )}
      <div className="flex flex-col gap-4">
        {groups.map(([subject, permissions]) => (
          <fieldset key={subject} className="m-0 min-w-0 border-0 p-0">
            <legend className="mb-1 text-body font-semibold text-ink">{subject}</legend>
            {permissions.map((permission) => {
              const cell = cellOf(permission, role, roles, drafts);
              const note =
                cell.kind === 'locked'
                  ? ' Required for Admin.'
                  : cell.kind === 'inherited'
                    ? ` From ${cell.from}.`
                    : '';
              return (
                <Checkbox
                  key={permission.key}
                  label={permission.key}
                  description={`${permission.scope === 'own' ? `${scopeText(permission)}. ` : ''}${permission.description}${note}${
                    badKey === permission.key ? ' This permission no longer exists.' : ''
                  }${isChanged(role, permission.key, drafts) ? ' Changed.' : ''}`}
                  checked={cell.kind === 'editable' ? cell.checked : true}
                  disabled={cell.kind !== 'editable'}
                  aria-invalid={badKey === permission.key || undefined}
                  onChange={() => onToggle(role, permission)}
                />
              );
            })}
          </fieldset>
        ))}
      </div>
    </Card>
  );
};

// `/t/admin/roles`, screen 7.2 (auth api-design 15, 16 and 18, UC-10, FR-AUTH-06, FR-AUTH-10): every role
// and the permissions each holds as one grid, edited as a draft and saved role by role as the full list.
// TrekLink Admin only.
export const RolesPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const roles = useRoles();
  const catalog = usePermissions();
  const wide = useMediaQuery('(min-width: 768px)', true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stored, setDrafts] = useState<Drafts>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [badKey, setBadKey] = useState<string | null>(null);
  const [lockout, setLockout] = useState<string | null>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  // A key the reloaded catalog no longer holds is not in the drafts, or every later save would fail on it.
  const drafts = useMemo(
    () =>
      catalog.data
        ? pruned(stored, new Set(catalog.data.map((permission) => permission.key)))
        : stored,
    [stored, catalog.data],
  );

  const list = roles.data ? sortRoles(roles.data) : undefined;
  const changed = list ? changedRoles(list, drafts) : [];
  const dirty = changed.length > 0;

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

  const toggle = (role: Role, permission: Permission) => {
    setDrafts((current) => toggled(role, permission.key, current));
    setBadKey(null);
  };

  const reload = () => {
    void queryClient.invalidateQueries({ queryKey: roleKeys.roles });
    void queryClient.invalidateQueries({ queryKey: roleKeys.permissions });
  };

  // One PUT per changed role, in column order; a failure does not stop the next role.
  const save = async () => {
    setPending(true);
    setFailures([]);
    const saved: Role[] = [];
    const failed: { role: Role; error: unknown }[] = [];
    for (const { role } of changed) {
      try {
        await saveRolePermissions(role.id, [...keysOf(role, drafts)].sort());
        saved.push(role);
      } catch (error) {
        failed.push({ role, error });
      }
    }
    const dropped = new Set([
      ...saved.map((role) => role.id),
      ...failed
        .filter(({ error }) => error instanceof ApiError && error.errorCode === 'NOT_FOUND')
        .map(({ role }) => role.id),
    ]);
    if (saved.length > 0) {
      // The grid reads the cached roles under the draft: clearing the draft before the refetch lands would
      // show the old set again for a moment, so the draft stays until the saved roles are read back.
      await queryClient.invalidateQueries({ queryKey: roleKeys.roles });
      // A role change applies on the next request (REQ-UBI-08), so the signed-in Admin reads themselves again.
      if (saved.some((role) => user?.roles.includes(role.key))) {
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
      }
    }
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !dropped.has(id))),
    );
    setConfirming(false);
    setPending(false);
    const rows: Failure[] = [];
    let notFound = false;
    for (const { role, error } of failed) {
      if (error instanceof ApiError && error.errorCode === 'ADMIN_LOCKOUT') {
        setLockout(error.message);
      } else if (error instanceof ApiError && error.errorCode === 'NOT_FOUND') {
        notFound = true;
        reload();
      } else if (error instanceof ApiError && error.errorCode === 'UNKNOWN_PERMISSION') {
        // The catalog changed under the client: mark the key, keep the draft, reload what is shown.
        setBadKey(UNKNOWN.exec(error.message)?.[1] ?? null);
        rows.push({ role, message: error.message });
        reload();
      } else {
        rows.push({
          role,
          message:
            error instanceof ApiError &&
            ['PERMISSION_SCOPE_MISMATCH', 'VALIDATION_FAILED'].includes(error.errorCode)
              ? error.message
              : messageOf(error),
        });
      }
    }
    setFailures(rows);
    if (saved.length > 0) {
      showToast(
        failed.length === 0
          ? 'Permissions updated'
          : `Permissions updated for ${saved.map((role) => role.key).join(', ')}`,
      );
      // Save is disabled once every role is saved, and a disabled button cannot take focus: the page does.
      setTimeout(() => {
        const button = saveRef.current;
        (button && !button.disabled ? button : pageRef.current)?.focus();
      }, 0);
    } else if (notFound) {
      showToast('Role not found.');
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
  if (failure || !list || !catalog.data || list.length === 0) {
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

  const role = list.find((item) => item.id === selectedId) ?? list[0];

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      aria-labelledby="roles-title"
      // A fit page: the grid scrolls inside itself, and below its width the body does (ui standard §7).
      data-fit-page=""
      className="flex min-h-0 flex-1 flex-col gap-4 outline-none"
    >
      <PageHeader
        id="roles-title"
        title="Roles and permissions"
        description="What each role may do. A change applies to its holders on their next request."
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p role="status" className="text-body-sm text-ink-muted">
          {changeSummary(changed)}
        </p>
        <div className="flex gap-2">
          <Button variant="ghost" disabled={!dirty || pending} onClick={() => setDrafts({})}>
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

      {failures.length > 0 && (
        <Alert tone="error">
          <ul className="m-0 list-none p-0">
            {failures.map(({ role: failed, message }) => (
              <li key={failed.id}>
                <span className="font-semibold">{failed.key}</span> <span>{message}</span>
              </li>
            ))}
          </ul>
        </Alert>
      )}

      {wide ? (
        <RoleGrid
          roles={list}
          catalog={catalog.data}
          drafts={drafts}
          badKey={badKey}
          onToggle={toggle}
        />
      ) : (
        // Below the grid width the role picker and its permissions scroll as one body (ui standard §7).
        <PageScrollBody label="Role permissions" className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="roles-select"
              className="mb-1.5 block text-body-sm font-semibold text-ink"
            >
              Role
            </label>
            <Select
              id="roles-select"
              value={role.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {list.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key}
                </option>
              ))}
            </Select>
          </div>
          <RolePanel
            role={role}
            roles={list}
            catalog={catalog.data}
            drafts={drafts}
            badKey={badKey}
            onToggle={toggle}
          />
        </PageScrollBody>
      )}

      {confirming && (
        <Dialog
          titleId="roles-confirm-title"
          title={confirmTitle(changed)}
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
          <div className="flex flex-col gap-3 text-body">
            {changed.map(({ role: item, diff }) => (
              <div key={item.id} className="flex flex-col gap-1">
                {changed.length > 1 && <p className="font-mono font-semibold">{item.key}</p>}
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
            ))}
          </div>
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
