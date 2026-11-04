import React from 'react';
import { useQueries } from '@tanstack/react-query';
import { FileText, Radio, Receipt, Siren } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import { useInvoices, type Invoice } from '../entities/billing/api';
import {
  contractKeys,
  fetchContract,
  useContracts,
  type Contract,
  type ContractStatus,
} from '../entities/contract/api';
import { formatDate, formatVnd } from '../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CollectionView,
  CONTRACT_STATUS,
  EmptyState,
  INVOICE_STATUS,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  buttonClasses,
  type CollectionField,
} from '../shared/ui';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { IncidentQueue } from '../widgets/IncidentQueue/IncidentQueue';

// The states whose devices are with the organization (design of screen 5.6, "devices out").
const RUNNING: ContractStatus[] = ['ACTIVE', 'ENDING', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED'];
// The "Running contracts" tile leaves a defaulted contract out: its devices are still out, but it no
// longer runs (dry run 2026-10-30, MF-05 step 1). The tile's hint names the defaulted count.
const IN_FORCE: ContractStatus[] = ['ACTIVE', 'ENDING', 'RETURN_DUE', 'OVERDUE'];

// The list endpoints' MAX_PAGE_SIZE (backend default, specs/platform/requirements.md §4): the
// dashboard reads one page of that size per source, as screen 5.6 says.
const MAX_PAGE_SIZE = 100;

// At most this many running contracts are read for the devices-out count; the tile says so beyond.
const DETAIL_LIMIT = 5;

const TILE_LINK =
  'block rounded-panel focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';

const Tile: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className={TILE_LINK}>
    {children}
  </Link>
);

// The summary tiles count one page of contracts (the list endpoint's page size).
const countOf = (contracts: Contract[], states: ContractStatus[]) =>
  contracts.filter((contract) => states.includes(contract.status)).length;

const SourceError: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
  <Alert
    tone="error"
    action={
      <Button size="sm" onClick={onRetry}>
        Try again
      </Button>
    }
  >
    {messageOf(error)}
  </Alert>
);

interface NextDate {
  contract: Contract;
  at: string;
  label: string;
}

// The next term end or return due time of each running contract, nearest first.
const nextDates = (contracts: Contract[]): NextDate[] =>
  contracts
    .filter((contract) => RUNNING.includes(contract.status))
    .map((contract) => ({
      contract,
      at:
        contract.status === 'ACTIVE' || contract.status === 'ENDING'
          ? (contract.currentTerm?.endsAt ?? null)
          : contract.returnDueAt,
      label:
        contract.status === 'ACTIVE' || contract.status === 'ENDING' ? 'Term ends' : 'Return due',
    }))
    .filter((row): row is NextDate => row.at !== null)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 3);

// /o, screen 5.6 (UC-55, D-059 rule 1): the Org Manager's landing page. It composes the list
// endpoints the other pages use, with their query keys, and changes nothing itself. Its lists render
// through CollectionView (chapter 06 §9, D-096) without a command bar: each is a short extract.
export const OrgDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const organization = user?.organization;
  const contracts = useContracts('o', { pageSize: MAX_PAGE_SIZE });
  const invoices = useInvoices('o', { pageSize: MAX_PAGE_SIZE });
  const overdue = useInvoices('o', { overdue: true, pageSize: MAX_PAGE_SIZE });
  // More than one page means the sums below cover the first page only; the page says so.
  const contractsCut = (contracts.data?.totalPages ?? 1) > 1;
  const invoicesCut = (invoices.data?.totalPages ?? 1) > 1;

  const items = contracts.data?.items ?? [];
  const running = items.filter((contract) => RUNNING.includes(contract.status));
  const details = useQueries({
    queries: running.slice(0, DETAIL_LIMIT).map((contract) => ({
      queryKey: contractKeys.detail(contract.id),
      queryFn: () => fetchContract(contract.id),
    })),
  });
  const devicesOut = details.reduce(
    (sum, detail) =>
      sum +
      (detail.data?.devices.filter(
        (device) => device.handedOverAt && !device.checkedInAt && !device.lostAt,
      ).length ?? 0),
    0,
  );
  const detailsLoading = details.some((detail) => detail.isLoading);
  const detailsFailed = details.find((detail) => detail.error);
  // The overdue count belongs to the same tile, so the tile waits for and fails with it too.
  const dueLoading = invoices.isLoading || overdue.isLoading;
  const dueError = invoices.error ?? overdue.error;
  const retryDue = () => {
    if (invoices.error) void invoices.refetch();
    if (overdue.error) void overdue.refetch();
  };

  // What each contract still owes across its invoices: a cancellation's voiding ADJUSTMENT sits on
  // the CLOSING invoice with a negative total, so an earlier invoice of a settled contract still
  // shows an amount due (ruling on treklink-web#87 point 4). Only contracts that owe count.
  const owedByContract = new Map<string, number>();
  for (const invoice of invoices.data?.items ?? []) {
    owedByContract.set(
      invoice.contract.id,
      (owedByContract.get(invoice.contract.id) ?? 0) + invoice.totalVnd - invoice.paidVnd,
    );
  }
  const unpaid = (invoices.data?.items ?? []).filter(
    (invoice) => invoice.status !== 'PAID' && (owedByContract.get(invoice.contract.id) ?? 0) > 0,
  );
  const due = [...owedByContract.values()].reduce((sum, owed) => sum + Math.max(owed, 0), 0);
  const overdueIds = new Set(
    (overdue.data?.items ?? [])
      .filter((invoice) => (owedByContract.get(invoice.contract.id) ?? 0) > 0)
      .map((invoice) => invoice.id),
  );
  // Overdue invoices first, then the others still unpaid; five rows.
  const toPay = [...unpaid]
    .sort((a, b) => Number(overdueIds.has(b.id)) - Number(overdueIds.has(a.id)))
    .slice(0, 5);
  const upcoming = nextDates(items);

  const invoiceFields: CollectionField<Invoice>[] = [
    {
      key: 'contract',
      label: 'Contract',
      render: (invoice) => invoice.contract.code ?? '',
      text: (invoice) => invoice.contract.code ?? '',
      // Kept on a phone row: the contract names what the invoice is for (review of treklink-web#355).
      compact: true,
    },
    {
      key: 'due',
      label: 'Still due',
      align: 'end',
      render: (invoice) => formatVnd(invoice.totalVnd - invoice.paidVnd),
      sortValue: (invoice) => invoice.totalVnd - invoice.paidVnd,
      compact: true,
    },
    {
      key: 'status',
      label: 'Status',
      render: (invoice) =>
        overdueIds.has(invoice.id) ? (
          <StatusBadge entry={{ label: 'Overdue', tone: 'critical' }} />
        ) : (
          <StatusBadge entry={INVOICE_STATUS[invoice.status]} />
        ),
      text: (invoice) => (overdueIds.has(invoice.id) ? 'Overdue' : INVOICE_STATUS[invoice.status].label),
      compact: true,
    },
    {
      key: 'pay',
      label: 'Pay',
      // A link, as before CollectionView, so it opens the invoice page in a new tab when asked to
      // (review of treklink-web#355); its name starts with its visible text (2.5.3).
      render: (invoice) => (
        <Link
          to={`/o/invoices/${invoice.id}`}
          className={buttonClasses('secondary', 'sm')}
          aria-label={`Pay ${invoice.number}`}
        >
          Pay
        </Link>
      ),
      align: 'end',
      compact: true,
    },
  ];

  const dateFields: CollectionField<NextDate>[] = [
    {
      key: 'status',
      label: 'Status',
      // A short badge with the date as muted text beside it (handoff item 12).
      render: ({ contract, at, label }) => (
        <StatusBadge entry={CONTRACT_STATUS[contract.status]} after={`${label} ${formatDate(at)}`} />
      ),
      text: ({ contract, at, label }) => `${CONTRACT_STATUS[contract.status].label}, ${label} ${formatDate(at)}`,
      compact: true,
    },
  ];

  return (
    <section aria-labelledby="dashboard-title" className="flex flex-col gap-5">
      <PageHeader
        id="dashboard-title"
        title="Overview"
        meta={organization ? `${organization.code}, ${organization.legalName}` : undefined}
        primaryAction={
          <Link to="/o/contracts/new" className={buttonClasses('primary')}>
            Request a contract
          </Link>
        }
      />

      {organization && organization.status !== 'ACTIVE' && (
        <Alert tone="warning">This cannot be done while it is {organization.status}.</Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {contracts.isLoading ? (
          [0, 1, 2, 3].map((tile) => <Skeleton key={tile} className="h-28" rounded="panel" />)
        ) : contracts.error ? (
          <div className="col-span-2 lg:col-span-4">
            <SourceError error={contracts.error} onRetry={() => void contracts.refetch()} />
          </div>
        ) : (
          <>
            <Tile to="/o/contracts">
              <StatCard
                label="Running contracts"
                value={countOf(items, IN_FORCE)}
                hint={`${countOf(items, ['REQUESTED'])} requested, ${countOf(items, ['APPROVED'])} approved${
                  countOf(items, ['DEFAULTED']) > 0 ? `, ${countOf(items, ['DEFAULTED'])} defaulted` : ''
                }`}
                icon={<FileText />}
              />
            </Tile>
            {detailsFailed ? (
              <SourceError
                error={detailsFailed.error}
                onRetry={() =>
                  details
                    .filter((detail) => detail.error)
                    .forEach((detail) => void detail.refetch())
                }
              />
            ) : (
              <Tile to="/o/contracts">
                <StatCard
                  label="Devices out"
                  value={detailsLoading ? '…' : devicesOut}
                  hint={
                    running.length > DETAIL_LIMIT
                      ? `on the first ${DETAIL_LIMIT} contracts, and more`
                      : `on ${running.length} contract${running.length === 1 ? '' : 's'}`
                  }
                  icon={<Radio />}
                />
              </Tile>
            )}
            <Tile to="/o/contracts">
              <StatCard
                label="Return due or overdue"
                value={countOf(items, ['RETURN_DUE', 'OVERDUE', 'DEFAULTED'])}
                hint={`${countOf(items, ['ENDING'])} ending after notice`}
                tone={
                  countOf(items, ['OVERDUE', 'DEFAULTED']) > 0
                    ? 'critical'
                    : countOf(items, ['RETURN_DUE']) > 0
                      ? 'attention'
                      : undefined
                }
                icon={<Siren />}
              />
            </Tile>
            {dueLoading ? (
              <Skeleton className="h-28" rounded="panel" />
            ) : dueError ? (
              <SourceError error={dueError} onRetry={retryDue} />
            ) : (
              <Tile to="/o/invoices">
                <StatCard
                  label="Still due"
                  value={formatVnd(due)}
                  hint={
                    overdueIds.size > 0
                      ? `${overdueIds.size} invoice${overdueIds.size === 1 ? '' : 's'} with an overdue line`
                      : `${unpaid.length} unpaid invoice${unpaid.length === 1 ? '' : 's'}`
                  }
                  tone={overdueIds.size > 0 ? 'critical' : undefined}
                  icon={<Receipt />}
                />
              </Tile>
            )}
          </>
        )}
      </div>

      {(contractsCut || invoicesCut) && (
        <Alert tone="info">
          {contractsCut && invoicesCut
            ? `Counted on the first ${MAX_PAGE_SIZE} contracts and invoices.`
            : contractsCut
              ? `Counted on the first ${MAX_PAGE_SIZE} contracts.`
              : `Counted on the first ${MAX_PAGE_SIZE} invoices.`}{' '}
          The Contracts and Invoices pages list them all.
        </Alert>
      )}

      {contracts.data && items.length === 0 && (
        <Card>
          <EmptyState
            title="Your organization has no contracts yet."
            action={
              <Link to="/o/contracts/new" className={buttonClasses('primary')}>
                Request a contract
              </Link>
            }
          />
        </Card>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader
            title="Invoices to pay"
            action={
              <Link to="/o/invoices" className={LINK}>
                All invoices
              </Link>
            }
          />
          {/* The overdue query orders the rows and marks them Overdue, so the widget waits for and
              fails with it too, as the Still due tile does. */}
          {dueError ? (
            <SourceError error={dueError} onRetry={retryDue} />
          ) : (
            <CollectionView<Invoice>
              label="Invoices to pay"
              items={dueLoading ? undefined : toPay}
              loading={dueLoading}
              itemId={(invoice) => invoice.id}
              itemName={(invoice) => invoice.number}
              itemHref={(invoice) => `/o/invoices/${invoice.id}`}
              fields={invoiceFields}
              noun={{ one: 'invoice', other: 'invoices' }}
              details={false}
              hideCommandBar
              fitNarrow
              emptyState={{ title: 'Nothing to pay right now.' }}
            />
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Next dates" />
            {contracts.isLoading ? (
              <Skeleton className="h-20" />
            ) : upcoming.length === 0 ? (
              <p className="text-body text-ink-muted">No running contract.</p>
            ) : (
              <CollectionView<NextDate>
                label="Next dates"
                items={upcoming}
                itemId={(row) => row.contract.id}
                itemName={(row) => row.contract.code}
                itemHref={(row) => `/o/contracts/${row.contract.id}`}
                fields={dateFields}
                noun={{ one: 'contract', other: 'contracts' }}
                views={['list']}
                details={false}
                hideCommandBar
                emptyState={{ title: 'No running contract.' }}
              />
            )}
          </Card>
          <IncidentQueue />
        </div>
      </div>
    </section>
  );
};
