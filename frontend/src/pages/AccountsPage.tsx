import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, Pencil, UserCheck, UserCog, UserPlus, UserX } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import {
  ACCOUNT_PAGE_SIZE,
  accountKeys,
  deactivateAccount,
  reactivateAccount,
  sendAccountReset,
  useAccounts,
  type AccountFilters,
  type AccountItem,
} from '../entities/account/api';
import { invitationPending, isAdmin, lastActiveAdminId, roleOf } from '../entities/account/model';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatUtc } from '../shared/lib/format';
import {
  Badge,
  BulkActionDialog,
  Button,
  CollectionView,
  PageHeader,
  Pagination,
  pageInfoOf,
  useToast,
  type BulkItem,
  type CollectionAction,
  type CollectionBulkAction,
  type CollectionField,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { messageOf } from '../shared/ui/errors';
import {
  ConfirmAccountDialog,
  DeactivateAccountDialog,
  EditAccountDialog,
  NewAccountDialog,
} from '../widgets/AccountDialogs/AccountDialogs';

type Action = { kind: 'edit' | 'deactivate' | 'reactivate' | 'reset'; account: AccountItem };

// Bulk actions of screen 7.1 (W29): each runs auth api-design 12, 13 or 14 once per selected account.
type BulkKind = 'deactivate' | 'reactivate' | 'reset';

const LAST_ADMIN_REASON = 'The last active Admin cannot be deactivated.';

const accountsText = (count: number) => `${count} ${count === 1 ? 'account' : 'accounts'}`;

const SEARCH_DELAY_MS = 300;

type StatusFilter = '' | 'true' | 'false';

// The filters and the page live in the URL, `?q=&isActive=&page=`, as on screens 7.3 and 7.4, so a
// reload or a shared link opens the same list.
const statusOf = (params: URLSearchParams): StatusFilter => {
  const value = params.get('isActive');
  return value === 'true' || value === 'false' ? value : '';
};
const pageOf = (params: URLSearchParams): number => {
  const page = Number(params.get('page'));
  return Number.isInteger(page) && page >= 1 ? page : 1;
};
const nameCellId = (id: string) => `account-name-${id}`;

// A change of the URL query, where `undefined` removes the key.
type Changes = Record<string, string | undefined>;
const withChanges = (current: URLSearchParams, changes: Changes): URLSearchParams => {
  const next = new URLSearchParams(current);
  for (const [key, value] of Object.entries(changes)) {
    if (value) next.set(key, value);
    else next.delete(key);
  }
  return next;
};

const StatusOf: React.FC<{ account: AccountItem }> = ({ account }) =>
  account.isActive ? <Badge tone="done">ACTIVE</Badge> : <Badge tone="ended">DEACTIVATED</Badge>;

const LastSignIn: React.FC<{ account: AccountItem }> = ({ account }) =>
  account.lastLoginAt ? (
    <span title={formatUtc(account.lastLoginAt)}>{formatDateTime(account.lastLoginAt)}</span>
  ) : (
    <span className="flex flex-col">
      <span>Never</span>
      {invitationPending(account) && (
        <span className="text-body-sm text-ink-muted">Invitation pending</span>
      )}
    </span>
  );

// `/t/admin/accounts`, screen 7.1 (auth api-design 09 to 14, UC-10, FR-AUTH-05 to FR-AUTH-10): the
// TrekLink accounts, created, edited, deactivated, reactivated, and sent a reset code. TrekLink Admin
// only. The server stays the judge of SELF_DEMOTION and LAST_ADMIN; the page disables the controls that
// would hit them and shows the server's message when one does.
export const AccountsPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [params, setParams] = useSearchParams();
  const q = params.get('q')?.trim() ?? '';
  const status = statusOf(params);
  const pageNumber = pageOf(params);
  // The search box text; the URL takes it once typing pauses.
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  // The account just created, whose name cell takes focus once its row is on screen (screen 7.1).
  const createdId = useRef<string | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  // A bulk action on the selection of the current page (chapter 06 §9.4, leader ruling 2026-11-03).
  const [bulk, setBulk] = useState<{ kind: BulkKind; rows: AccountItem[] } | null>(null);

  // One change of the URL query: `undefined` removes a key. A new filter starts again on page 1.
  const update = (changes: Changes, options?: { replace?: boolean }) =>
    setParams((current) => withChanges(current, changes), options);

  // A search typed into the box reaches the URL after a pause, replacing the entry, so Back does not
  // step through every keystroke. Nothing is written while the box already matches the URL.
  useEffect(() => {
    const typed = search.trim();
    if (typed === q) return;
    const timer = setTimeout(
      () =>
        setParams((current) => withChanges(current, { q: typed || undefined, page: undefined }), {
          replace: true,
        }),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [search, q, setParams]);

  // Back, Forward or a link can change `q` under the box; the box then shows it (state adjusted during
  // render, as React advises for state derived from a changed value).
  const [shownQ, setShownQ] = useState(q);
  if (shownQ !== q) {
    setShownQ(q);
    if (search.trim() !== q) setSearch(q);
  }

  const filters = useMemo<AccountFilters>(
    () => ({ q: q || undefined, isActive: status === '' ? undefined : status === 'true' }),
    [q, status],
  );
  const accounts = useAccounts(filters, pageNumber, { pageSize: ACCOUNT_PAGE_SIZE });
  // Every active account, to know whether one Admin is the last (the server still decides).
  const active = useAccounts({ isActive: true }, 1, { pageSize: 100 });
  const lastAdmin = lastActiveAdminId(active.data);

  // After a create, focus moves to the new row's name cell as soon as the reloaded list shows it.
  useEffect(() => {
    const id = createdId.current;
    if (!id || !accounts.data?.items.some((row) => row.id === id)) return;
    document.getElementById(nameCellId(id))?.focus();
    createdId.current = null;
  }, [accounts.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: accountKeys.all });
  const close = () => setAction(null);
  const done = (message: string) => {
    close();
    showToast(message);
    void refresh();
  };
  const gone = () => {
    close();
    showToast('Account not found.');
    void refresh();
  };

  const failure = accounts.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  // Active: Edit, Send reset code and Deactivate; the last active Admin's Deactivate stays visible,
  // unavailable, with its reason (screen 7.1). Deactivated: Reactivate. Item actions with the tooltip
  // of chapter 06 §9.5; Deactivate keeps its reason, which a status menu could not show.
  const itemActions: CollectionAction<AccountItem>[] = [
    { key: 'edit', label: 'Edit', icon: <Pencil />, allowed: (account) => account.isActive, onSelect: (account) => setAction({ kind: 'edit', account }) },
    { key: 'reset', label: 'Send reset code', icon: <KeyRound />, allowed: (account) => account.isActive, onSelect: (account) => setAction({ kind: 'reset', account }) },
    {
      key: 'deactivate',
      slot: 'active',
      label: 'Deactivate',
      icon: <UserX />,
      destructive: true,
      allowed: (account) => account.isActive,
      unavailableReason: (account) => (account.id === lastAdmin ? LAST_ADMIN_REASON : undefined),
      onSelect: (account) => setAction({ kind: 'deactivate', account }),
    },
    { key: 'reactivate', label: 'Reactivate', icon: <UserCheck />, slot: 'active', allowed: (account) => !account.isActive, onSelect: (account) => setAction({ kind: 'reactivate', account }) },
  ];

  const bulkActions: CollectionBulkAction<AccountItem>[] = [
    { key: 'reset', label: (count) => `Send reset code to ${accountsText(count)}`, appliesTo: (row) => row.isActive, onSelect: (rows) => setBulk({ kind: 'reset', rows }) },
    { key: 'reactivate', label: (count) => `Reactivate ${accountsText(count)}`, appliesTo: (row) => !row.isActive, onSelect: (rows) => setBulk({ kind: 'reactivate', rows }) },
    {
      key: 'deactivate',
      label: (count) => `Deactivate ${accountsText(count)}`,
      destructive: true,
      appliesTo: (row) => row.isActive && row.id !== lastAdmin && row.id !== user?.id,
      onSelect: (rows) => setBulk({ kind: 'deactivate', rows }),
    },
  ];
  const itemsOf = (rows: AccountItem[]): BulkItem[] => rows.map((row) => ({ id: row.id, label: row.fullName }));
  const bulkDone = () => void refresh();

  // Screen 7.1: the "Last active Admin" line sits under the name, beside the disabled Deactivate.
  const nameCell = (account: AccountItem) => (
    <span id={nameCellId(account.id)} tabIndex={-1} className="flex flex-col py-1.5">
      <span className="font-semibold">
        {account.fullName}
        {account.id === user?.id && <span className="font-normal text-ink-muted"> (you)</span>}
      </span>
      <span className="text-body-sm text-ink-muted">{account.email}</span>
      <span className="text-body-sm text-ink-muted">{account.phoneNumber ?? 'None'}</span>
      {account.id === lastAdmin && (
        <span className="text-body-sm font-semibold text-ink-muted">Last active Admin</span>
      )}
    </span>
  );

  const roleBadge = (account: AccountItem) => <Badge>{roleOf(account)}</Badge>;

  const fields: CollectionField<AccountItem>[] = [
    { key: 'role', label: 'Role', render: roleBadge, compact: true },
    { key: 'status', label: 'Status', render: (row) => <StatusOf account={row} />, compact: true },
    { key: 'lastLoginAt', label: 'Last sign-in', render: (row) => <LastSignIn account={row} /> },
    {
      key: 'createdAt',
      label: 'Created',
      render: (row) => <span title={formatUtc(row.createdAt)}>{formatDateTime(row.createdAt)}</span>,
      hideWithPane: true,
    },
  ];

  const data = accounts.data;

  return (
    <section aria-labelledby="accounts-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        id="accounts-title"
        title="Accounts"
        meta={
          data ? `${data.totalCount} ${data.totalCount === 1 ? 'account' : 'accounts'}` : undefined
        }
        description="The TrekLink Staff and Admin accounts that sign in to the platform."
        primaryAction={
          <Button
            variant="primary"
            icon={<UserPlus aria-hidden="true" className="h-4 w-4" />}
            onClick={() => setCreating(true)}
          >
            New account
          </Button>
        }
      />

      <CollectionView<AccountItem>
        icon={<UserCog />}
        label="Accounts"
        items={data?.items}
        loading={accounts.isPending}
        error={failure ? <ErrorState error={failure} onRetry={() => void accounts.refetch()} /> : undefined}
        itemId={(row) => row.id}
        itemName={(row) => row.fullName}
        itemTitle={nameCell}
        fields={fields}
        noun={{ one: 'account', other: 'accounts' }}
        itemActions={itemActions}
        bulkActions={bulkActions}
        search={{ label: 'Search accounts', placeholder: 'Name or email' }}
        filters={[
          { key: '', label: 'All accounts' },
          { key: 'true', label: 'Active' },
          { key: 'false', label: 'Deactivated' },
        ]}
        query={{ search, filter: status, sort: null }}
        onQueryChange={(next) => {
          setSearch(next.search);
          if (next.filter !== status) update({ isActive: next.filter || undefined, page: undefined });
        }}
        pageInfo={pageInfoOf(data)}
        emptyState={{ title: 'No accounts yet.', description: 'Create the first account with New account.' }}
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={ACCOUNT_PAGE_SIZE}
              onPage={(page) => update({ page: page > 1 ? String(page) : undefined })}
            />
          ) : undefined
        }
      />

      {bulk?.kind === 'deactivate' && (
        <BulkActionDialog
          title={`Deactivate ${accountsText(bulk.rows.length)}?`}
          confirmLabel={`Deactivate ${accountsText(bulk.rows.length)}`}
          description="They cannot sign in and their sessions end at once. Your own account and the last active Admin are left out."
          destructive
          needsReason
          items={itemsOf(bulk.rows)}
          run={(item, reason) => deactivateAccount(item.id, reason ?? '')}
          onFinished={bulkDone}
          onClose={() => setBulk(null)}
        />
      )}
      {bulk?.kind === 'reactivate' && (
        <BulkActionDialog
          title={`Reactivate ${accountsText(bulk.rows.length)}?`}
          confirmLabel={`Reactivate ${accountsText(bulk.rows.length)}`}
          description="They can sign in again with their current password."
          items={itemsOf(bulk.rows)}
          run={(item) => reactivateAccount(item.id)}
          onFinished={bulkDone}
          onClose={() => setBulk(null)}
        />
      )}
      {bulk?.kind === 'reset' && (
        <BulkActionDialog
          title={`Send a reset code to ${accountsText(bulk.rows.length)}?`}
          confirmLabel={`Send reset code to ${accountsText(bulk.rows.length)}`}
          description="Each account email receives a code to set a new password. An account asked again too soon is refused (OTP cooldown)."
          items={itemsOf(bulk.rows)}
          run={(item) => sendAccountReset(item.id)}
          onFinished={bulkDone}
          onClose={() => setBulk(null)}
        />
      )}
      {creating && (
        <NewAccountDialog
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false);
            showToast('Account created, invitation sent');
            // The list is newest first, so with no filter the new account heads page 1.
            setSearch('');
            setParams(new URLSearchParams());
            createdId.current = created.id;
            void refresh();
          }}
        />
      )}
      {action?.kind === 'edit' && (
        <EditAccountDialog
          account={action.account}
          isSelf={action.account.id === user?.id && isAdmin(action.account)}
          onClose={close}
          onNotFound={gone}
          onSaved={() => done('Account updated')}
        />
      )}
      {action?.kind === 'deactivate' && (
        <DeactivateAccountDialog
          account={action.account}
          onClose={close}
          onNotFound={gone}
          onDone={() => done('Account deactivated')}
        />
      )}
      {(action?.kind === 'reactivate' || action?.kind === 'reset') && (
        <ConfirmAccountDialog
          kind={action.kind}
          account={action.account}
          onClose={close}
          onNotFound={gone}
          onDone={() =>
            done(
              action.kind === 'reactivate'
                ? 'Account reactivated'
                : 'Reset code sent to the account email',
            )
          }
        />
      )}
    </section>
  );
};
