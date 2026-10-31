import React, { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useAuth } from '../app/providers/useAuth';
import {
  ACCOUNT_PAGE_SIZE,
  accountKeys,
  useAccounts,
  type AccountFilters,
  type AccountItem,
} from '../entities/account/api';
import { invitationPending, isAdmin, lastActiveAdminId, roleOf } from '../entities/account/model';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Badge,
  Button,
  DataTable,
  PageHeader,
  Pagination,
  Select,
  Toolbar,
  ToolbarSearch,
  useToast,
  type Column,
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

const SEARCH_DELAY_MS = 300;

const StatusOf: React.FC<{ account: AccountItem }> = ({ account }) =>
  account.isActive ? <Badge tone="done">ACTIVE</Badge> : <Badge tone="ended">DEACTIVATED</Badge>;

const LastSignIn: React.FC<{ account: AccountItem }> = ({ account }) =>
  account.lastLoginAt ? (
    <span title={`${account.lastLoginAt} UTC`}>{formatDateTime(account.lastLoginAt)}</span>
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
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'' | 'true' | 'false'>('');
  const [pageNumber, setPageNumber] = useState(1);
  const [creating, setCreating] = useState(false);
  const [action, setAction] = useState<Action | null>(null);
  // The phone card whose Actions menu is open (screen 7.1, 360 px layout).
  const [openCard, setOpenCard] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setQ(search.trim());
      setPageNumber(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [search]);

  const filters = useMemo<AccountFilters>(
    () => ({ q: q || undefined, isActive: status === '' ? undefined : status === 'true' }),
    [q, status],
  );
  const accounts = useAccounts(filters, pageNumber);
  // Every active account, to know whether one Admin is the last (the server still decides).
  const active = useAccounts({ isActive: true }, 1, { pageSize: 100 });
  const lastAdmin = lastActiveAdminId(active.data);

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

  const rowActions = (account: AccountItem) => {
    const name = account.fullName;
    const isLastAdmin = account.id === lastAdmin;
    const button = (label: string, kind: Action['kind'], disabled = false) => (
      <Button
        variant="ghost"
        size="sm"
        className="min-h-11"
        aria-label={`${label} ${name}`}
        disabled={disabled}
        onClick={() => setAction({ kind, account })}
      >
        {label}
      </Button>
    );
    return (
      <div className="flex flex-wrap items-center gap-1">
        {account.isActive ? (
          <>
            {button('Edit', 'edit')}
            {button('Send reset code to', 'reset')}
            {button('Deactivate', 'deactivate', isLastAdmin)}
            {isLastAdmin && <span className="text-body-sm text-ink-muted">Last active Admin</span>}
          </>
        ) : (
          button('Reactivate', 'reactivate')
        )}
      </div>
    );
  };

  const nameCell = (account: AccountItem) => (
    <span className="flex flex-col py-1.5">
      <span className="font-semibold">
        {account.fullName}
        {account.id === user?.id && <span className="font-normal text-ink-muted"> (you)</span>}
      </span>
      <span className="text-body-sm text-ink-muted">{account.email}</span>
      <span className="text-body-sm text-ink-muted">{account.phoneNumber ?? 'None'}</span>
    </span>
  );

  const roleBadge = (account: AccountItem) => <Badge>{roleOf(account)}</Badge>;

  const columns: Column<AccountItem>[] = [
    { key: 'name', header: 'Account', cell: nameCell },
    { key: 'role', header: 'Role', cell: roleBadge, width: '7rem' },
    { key: 'status', header: 'Status', cell: (row) => <StatusOf account={row} />, width: '9rem' },
    { key: 'lastLoginAt', header: 'Last sign-in', cell: (row) => <LastSignIn account={row} /> },
    {
      key: 'createdAt',
      header: 'Created',
      cell: (row) => <span title={`${row.createdAt} UTC`}>{formatDateTime(row.createdAt)}</span>,
      hideOnMobile: true,
    },
  ];

  const data = accounts.data;
  const filtered = Boolean(q) || status !== '';

  return (
    <section aria-labelledby="accounts-title" className="flex flex-col gap-4">
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

      <Toolbar
        label="Account filters"
        start={
          <ToolbarSearch
            id="accounts-search"
            label="Search accounts"
            placeholder="Name or email"
            value={search}
            onChange={setSearch}
          />
        }
        end={
          <Select
            aria-label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as '' | 'true' | 'false');
              setPageNumber(1);
            }}
          >
            <option value="">All accounts</option>
            <option value="true">Active</option>
            <option value="false">Deactivated</option>
          </Select>
        }
      />

      <DataTable<AccountItem>
        caption="Accounts"
        columns={columns}
        rows={data?.items}
        rowId={(row) => row.id}
        loading={accounts.isPending}
        error={
          failure ? (
            <ErrorState error={failure} onRetry={() => void accounts.refetch()} />
          ) : undefined
        }
        empty={{
          title: filtered ? 'No results match your filters.' : 'No accounts yet.',
          description: filtered ? undefined : 'Create the first account with New account.',
          action: filtered ? (
            <Button
              variant="secondary"
              onClick={() => {
                setSearch('');
                setStatus('');
              }}
            >
              Clear filters
            </Button>
          ) : undefined,
        }}
        rowActions={rowActions}
        renderCard={(row) => (
          <div className="flex flex-col gap-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              {nameCell(row)}
              {roleBadge(row)}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusOf account={row} />
              <LastSignIn account={row} />
            </div>
            <div>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                aria-expanded={openCard === row.id}
                aria-controls={`account-actions-${row.id}`}
                aria-label={`Actions for ${row.fullName}`}
                onClick={() => setOpenCard(openCard === row.id ? null : row.id)}
              >
                Actions
              </Button>
              {openCard === row.id && <div id={`account-actions-${row.id}`}>{rowActions(row)}</div>}
            </div>
          </div>
        )}
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={ACCOUNT_PAGE_SIZE}
              onPage={setPageNumber}
            />
          ) : undefined
        }
      />

      {creating && (
        <NewAccountDialog
          onClose={() => setCreating(false)}
          onCreated={() => {
            setCreating(false);
            showToast('Account created, invitation sent');
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
