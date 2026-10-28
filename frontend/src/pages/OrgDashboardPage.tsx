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
  CONTRACT_STATUS,
  DataTable,
  EmptyState,
  INVOICE_STATUS,
  PageHeader,
  Skeleton,
  StatCard,
  StatusBadge,
  buttonClasses,
  type Column,
} from '../shared/ui';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

// The states whose devices are with the organization (design of screen 5.6, "devices out").
const RUNNING: ContractStatus[] = ['ACTIVE', 'ENDING', 'RETURN_DUE', 'OVERDUE', 'DEFAULTED'];

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

// The next term end or return due time of each running contract, nearest first.
const nextDates = (contracts: Contract[]) =>
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
    .filter((row): row is { contract: Contract; at: string; label: string } => row.at !== null)
    .sort((a, b) => a.at.localeCompare(b.at))
    .slice(0, 3);

// /o, screen 5.6 (UC-55, D-059 rule 1): the Org Manager's landing page. It composes the list
// endpoints the other pages use, with their query keys, and changes nothing itself.
export const OrgDashboardPage: React.FC = () => {
  const { user } = useAuth();
  const organization = user?.organization;
  const contracts = useContracts('o', {});
  const invoices = useInvoices('o', {});
  const overdue = useInvoices('o', { overdue: true });

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

  const invoiceColumns: Column<Invoice>[] = [
    {
      key: 'number',
      header: 'Invoice',
      cell: (invoice) => (
        <Link to={`/o/invoices/${invoice.id}`} className={LINK}>
          {invoice.number}
        </Link>
      ),
    },
    { key: 'contract', header: 'Contract', cell: (invoice) => invoice.contract.code ?? '' },
    {
      key: 'due',
      header: 'Still due',
      align: 'end',
      cell: (invoice) => formatVnd(invoice.totalVnd - invoice.paidVnd),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (invoice) =>
        overdueIds.has(invoice.id) ? (
          <StatusBadge entry={{ label: 'Overdue', tone: 'critical' }} />
        ) : (
          <StatusBadge entry={INVOICE_STATUS[invoice.status]} />
        ),
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
                value={running.length}
                hint={`${countOf(items, ['REQUESTED'])} requested, ${countOf(items, ['APPROVED'])} approved`}
                icon={<FileText />}
              />
            </Tile>
            <Tile to="/o/contracts">
              <StatCard
                label="Devices out"
                value={detailsLoading ? '…' : devicesOut}
                hint={
                  running.length > DETAIL_LIMIT
                    ? `on the first ${DETAIL_LIMIT} contracts, and more`
                    : `on ${running.length} running contract${running.length === 1 ? '' : 's'}`
                }
                icon={<Radio />}
              />
            </Tile>
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
            {invoices.isLoading ? (
              <Skeleton className="h-28" rounded="panel" />
            ) : invoices.error ? (
              <SourceError error={invoices.error} onRetry={() => void invoices.refetch()} />
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
          {invoices.error ? (
            <SourceError error={invoices.error} onRetry={() => void invoices.refetch()} />
          ) : (
            <DataTable
              caption="Invoices to pay"
              columns={invoiceColumns}
              rows={invoices.isLoading ? undefined : toPay}
              rowId={(invoice) => invoice.id}
              loading={invoices.isLoading}
              empty={{ title: 'Nothing to pay right now.' }}
              rowActions={(invoice) => (
                <Link
                  to={`/o/invoices/${invoice.id}`}
                  className={buttonClasses('secondary', 'sm')}
                  aria-label={`Pay ${invoice.number}`}
                >
                  Pay
                </Link>
              )}
            />
          )}
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Next dates" />
            {contracts.isLoading ? (
              <Skeleton className="h-20" />
            ) : nextDates(items).length === 0 ? (
              <p className="text-body text-ink-muted">No running contract.</p>
            ) : (
              <ul className="flex flex-col divide-y divide-line">
                {nextDates(items).map(({ contract, at, label }) => (
                  <li key={contract.id} className="flex items-center justify-between gap-3 py-2">
                    <Link to={`/o/contracts/${contract.id}`} className={LINK}>
                      {contract.code}
                    </Link>
                    <span className="flex items-center gap-2 text-body-sm text-ink-muted">
                      {label} {formatDate(at)}
                      <StatusBadge entry={CONTRACT_STATUS[contract.status]} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardHeader title="Open incidents" />
            <EmptyState
              title="Incidents are not available yet."
              description="The incident list joins this page once its endpoint is served."
            />
          </Card>
        </div>
      </div>
    </section>
  );
};
