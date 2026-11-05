import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { PageScrollBody } from '../shared/ui/PageChrome';
import { useAuth } from '../app/providers/useAuth';
import { ME_KEY } from '../features/account-menu/api';
import {
  organizationRoleKeys,
  saveOrganizationRole,
  useOrganizationRoles,
  type OrganizationRoleKey,
} from '../entities/organization-role/api';
import {
  canReset,
  isCustomised,
  organizationCellOf,
  resetDraft,
  toGridCatalog,
  toGridRoles,
  versionOf,
} from '../entities/organization-role/model';
import type { Permission, Role } from '../entities/role/api';
import {
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
const OUTSIDE = /^(.+) cannot be granted to this role\.$/;

interface Failure {
  role: Role;
  message: string;
}

// `/o/roles`, screen 3.7 (auth api-design 19 and 20, UC-10, FR-AUTH-06, FR-AUTH-10, D-095): the two roles of
// the organization as the grid of screen 7.2, inside the limits TrekLink sets. Edited as a draft and saved
// role by role as the full list with the version read. Org Manager only; the organization is the caller's,
// never part of the route.
export const OrganizationRolesPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const view = useOrganizationRoles();
  const wide = useMediaQuery('(min-width: 768px)', true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stored, setDrafts] = useState<Drafts>({});
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [badKey, setBadKey] = useState<string | null>(null);
  const [lockout, setLockout] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLElement>(null);

  const roles = useMemo(
    () => (view.data ? sortRoles(toGridRoles(view.data)) : undefined),
    [view.data],
  );
  const catalog = useMemo(
    () => (view.data ? toGridCatalog(view.data.catalog) : undefined),
    [view.data],
  );
  // A key the reloaded ceiling no longer holds is not in the drafts, or every later save would fail on it.
  const drafts = useMemo(
    () => (catalog ? pruned(stored, new Set(catalog.map((permission) => permission.key))) : stored),
    [stored, catalog],
  );
  const changed = roles ? changedRoles(roles, drafts) : [];
  const dirty = changed.length > 0;
  const status = user?.organization?.status ?? 'ACTIVE';
  const readOnly = status !== 'ACTIVE';

  // A closed or reloaded tab would lose the draft: the browser asks first.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const failure = view.error;
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
    void queryClient.invalidateQueries({ queryKey: organizationRoleKeys.all });
  };

  // One PUT per changed role, in column order; a failure does not stop the next role.
  const save = async () => {
    if (!view.data) return;
    setPending(true);
    setFailures([]);
    const saved: Role[] = [];
    const failed: { role: Role; error: unknown }[] = [];
    for (const { role } of changed) {
      try {
        await saveOrganizationRole(
          role.key as OrganizationRoleKey,
          [...keysOf(role, drafts)].sort(),
          versionOf(view.data, role.key),
        );
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
    setDrafts((current) =>
      Object.fromEntries(Object.entries(current).filter(([id]) => !dropped.has(id))),
    );
    setConfirming(false);
    setPending(false);

    if (saved.length > 0) {
      reload();
      // The Manager's own permissions may have changed, so the signed-in Manager reads themselves again.
      if (saved.some((role) => role.key === 'ORG_MANAGER')) {
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
      }
    }
    const rows: Failure[] = [];
    let notFound = false;
    for (const { role, error } of failed) {
      const code = error instanceof ApiError ? error.errorCode : null;
      if (code === 'MANAGER_LOCKOUT' && error instanceof ApiError) {
        setLockout(error.message);
      } else if (code === 'STALE_VERSION') {
        setStale(true);
      } else if (code === 'NOT_FOUND') {
        notFound = true;
        reload();
      } else if (code === 'UNKNOWN_PERMISSION' && error instanceof ApiError) {
        // The catalog changed under the client: mark the key, keep the draft, reload what is shown.
        setBadKey(UNKNOWN.exec(error.message)?.[1] ?? null);
        rows.push({ role, message: error.message });
        reload();
      } else if (code === 'PERMISSION_OUT_OF_CEILING' && error instanceof ApiError) {
        // The ceiling changed under the client; the unavailable cells make this a backstop.
        setBadKey(OUTSIDE.exec(error.message)?.[1] ?? null);
        rows.push({ role, message: error.message });
        reload();
      } else if (code === 'ORGANIZATION_NOT_ACTIVE' && error instanceof ApiError) {
        rows.push({ role, message: error.message });
        void queryClient.invalidateQueries({ queryKey: ME_KEY });
        reload();
      } else {
        rows.push({
          role,
          message:
            error instanceof ApiError && code === 'VALIDATION_FAILED'
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

  if (view.isPending) {
    return (
      <section aria-labelledby="org-roles-title" className="flex flex-col gap-4">
        <PageHeader id="org-roles-title" title="Roles and permissions" />
        <Skeleton className="h-64 w-full" />
      </section>
    );
  }
  if (failure || !view.data || !roles || !catalog || roles.length === 0) {
    return (
      <section aria-labelledby="org-roles-title" className="flex flex-col gap-4">
        <PageHeader id="org-roles-title" title="Roles and permissions" />
        <ErrorState error={failure} onRetry={() => void view.refetch()} />
      </section>
    );
  }

  const data = view.data;
  const role = roles.find((item) => item.id === selectedId) ?? roles[0];
  const cellFor = (permission: Permission, item: Role) =>
    organizationCellOf(permission, item, data, drafts);

  return (
    <section
      ref={pageRef}
      tabIndex={-1}
      aria-labelledby="org-roles-title"
      // A fit page: the grid scrolls inside itself, and below its width the body does (ui standard §7).
      data-fit-page=""
      className="flex min-h-0 flex-1 flex-col gap-4 outline-none"
    >
      <PageHeader
        id="org-roles-title"
        title="Roles and permissions"
        description="What the roles of your organization may do, inside the limits TrekLink sets. A change applies to their holders on their next request."
      />

      {readOnly && (
        <Alert tone="warning">
          Role permissions can be read but not changed while your organization is{' '}
          {status.toLowerCase()}.
        </Alert>
      )}

      {!readOnly && (
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
      )}

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
          roles={roles}
          catalog={catalog}
          drafts={drafts}
          badKey={badKey}
          onToggle={toggle}
          cellFor={cellFor}
          lockedFor="Manager"
          customised={(item, key) => isCustomised(data, item.key, key)}
          readOnly={readOnly}
          caption="Permissions by role of your organization"
          headerExtra={(item) =>
            readOnly ? null : (
              <button
                type="button"
                className="mt-1 text-caption font-semibold text-accent underline disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={`Reset to TrekLink default for ${item.key}`}
                disabled={pending || !canReset(data, item.key, drafts)}
                onClick={() => setDrafts((current) => resetDraft(data, item.key, current))}
              >
                Reset to TrekLink default
              </button>
            )
          }
        />
      ) : (
        // Below the grid width the role picker and its permissions scroll as one body (ui standard §7).
        <PageScrollBody label="Role permissions" className="flex flex-col gap-4">
          <div>
            <label
              htmlFor="org-roles-select"
              className="mb-1.5 block text-body-sm font-semibold text-ink"
            >
              Role
            </label>
            <Select
              id="org-roles-select"
              value={role.id}
              onChange={(event) => setSelectedId(event.target.value)}
            >
              {roles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.key}
                </option>
              ))}
            </Select>
          </div>
          <Card aria-labelledby="org-role-panel-title">
            <h2 id="org-role-panel-title" className="text-title text-ink">
              {role.key}
            </h2>
            <p className="mb-4 flex flex-wrap items-center gap-2 text-body-sm text-ink-muted">
              {roleTitle(role.key)}, Organization
              <Badge>System role</Badge>
            </p>
            {!readOnly && (
              <Button
                variant="ghost"
                className="mb-4"
                disabled={pending || !canReset(data, role.key, drafts)}
                onClick={() => setDrafts((current) => resetDraft(data, role.key, current))}
              >
                Reset to TrekLink default
              </Button>
            )}
            <div className="flex flex-col gap-4">
              {groupBySubject(catalog).map(([subject, permissions]) => (
                <fieldset key={subject} className="m-0 min-w-0 border-0 p-0">
                  <legend className="mb-1 text-body font-semibold text-ink">{subject}</legend>
                  {permissions.map((permission) => {
                    const cell = cellFor(permission, role);
                    if (cell.kind === 'unavailable') return null;
                    const note =
                      cell.kind === 'locked'
                        ? ' Required for Manager.'
                        : cell.kind === 'inherited'
                          ? ` From ${cell.from}.`
                          : '';
                    return (
                      <Checkbox
                        key={permission.key}
                        label={permission.key}
                        description={`${permission.scope === 'own' ? `${scopeText(permission)}. ` : ''}${permission.description}${note}${
                          badKey === permission.key ? ' This permission no longer exists.' : ''
                        }${isCustomised(data, role.key, permission.key) ? ' Customised.' : ''}${
                          isChanged(role, permission.key, drafts) ? ' Changed.' : ''
                        }`}
                        checked={cell.kind === 'editable' ? cell.checked : true}
                        disabled={cell.kind !== 'editable' || readOnly}
                        aria-invalid={badKey === permission.key || undefined}
                        onChange={() => toggle(role, permission)}
                      />
                    );
                  })}
                </fieldset>
              ))}
            </div>
          </Card>
        </PageScrollBody>
      )}

      {confirming && (
        <Dialog
          titleId="org-roles-confirm-title"
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
          titleId="org-roles-lockout-title"
          title="Managers must keep role management"
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

      {stale && (
        <Dialog
          titleId="org-roles-stale-title"
          title="Someone else changed this"
          onClose={() => setStale(false)}
          size="sm"
          footer={
            <Button
              variant="primary"
              onClick={() => {
                reload();
                setStale(false);
              }}
            >
              Reload
            </Button>
          }
        >
          <p className="text-body text-ink-muted">
            The permissions of a role changed since you loaded them. Reload to see the latest; your
            unsaved changes stay in the grid.
          </p>
        </Dialog>
      )}
    </section>
  );
};
