import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  cancelContract,
  contractKeys,
  formatNextDate,
  planLabel,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type Contract,
  type ContractFilters,
  type ContractStatus,
  type PlanType,
} from '../entities/contract/api';
import { hasAnyRole } from '../shared/lib/permissions';
import { matchesText } from '../shared/lib/filter';
import {
  Button,
  DataTable,
  Pagination,
  Select,
  StateChangeDialog,
  Toolbar,
  ToolbarSearch,
  type Column,
  type RowAction,
  type StateTransition,
} from '../shared/ui';
import { Badge, ErrorState, PageTitle } from '../shared/ui/bits';
import { PRIMARY_BUTTON } from '../shared/ui/styles';

const STATUSES = Object.keys(STATUS_LABELS) as ContractStatus[];

// rentals api-design 06: the Manager cancels a REQUESTED or APPROVED contract before handover.
const CANCEL: StateTransition<'CANCELLED'> = {
  target: 'CANCELLED',
  label: 'Cancel contract',
  destructive: true,
  needsReason: true,
  description:
    'The contract ends before handover and its devices are released. A holding fee already paid is retained (MSG15).',
  cancelLabel: 'Keep contract',
  successMessage: 'Contract cancelled.',
};

// /o/contracts, the contract list of screen 5.2 (rentals api-design 02). Org Manager and Org
// Operator read it; only the Manager sees Request a contract and the Cancel row action (W29).
export const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']);
  const [filters, setFilters] = useState<ContractFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = useContracts('o', filters);
  const [code, setCode] = useState('');
  const [cancelling, setCancelling] = useState<Contract | null>(null);
  const filtered = filters.status !== undefined || filters.planType !== undefined || code !== '';
  const rows = data?.items.filter((contract) => matchesText(code, contract.code));
  const clear = () => {
    setCode('');
    setFilters({ pageNumber: 1 });
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: contractKeys.all });

  const requestLink = isManager && (
    <Link to="/o/contracts/new" className={PRIMARY_BUTTON}>
      Request a contract
    </Link>
  );

  const columns: Column<Contract>[] = [
    { key: 'code', header: 'Code', cell: (contract) => contract.code },
    { key: 'plan', header: 'Plan', cell: planLabel },
    { key: 'devices', header: 'Devices', align: 'end', cell: (contract) => contract.quantity },
    {
      key: 'status',
      header: 'Status',
      cell: (contract) => <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>,
    },
    { key: 'next', header: 'Next date', cell: (contract) => formatNextDate(contract) },
  ];

  const rowActions = (contract: Contract): RowAction[] =>
    isManager && (contract.status === 'REQUESTED' || contract.status === 'APPROVED')
      ? [{ key: 'cancel', label: 'Cancel contract', destructive: true, onSelect: () => setCancelling(contract) }]
      : [];

  return (
    <section aria-labelledby="contracts-title">
      <PageTitle id="contracts-title" title="Contracts" action={requestLink} />

      <Toolbar
        label="Contract filters"
        start={
          <>
            <ToolbarSearch id="contracts-code" label="Search by contract code" placeholder="RC-..." value={code} onChange={setCode} />
            <span className="w-40">
              <Select
                aria-label="Plan"
                value={filters.planType ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, planType: (event.target.value || undefined) as PlanType | undefined, pageNumber: 1 })
                }
              >
                <option value="">Every plan</option>
                <option value="MONTHLY">Monthly</option>
                <option value="DAY">Day plan</option>
              </Select>
            </span>
            <span className="w-44">
              <Select
                aria-label="Status"
                value={filters.status ?? ''}
                onChange={(event) =>
                  setFilters({ ...filters, status: (event.target.value || undefined) as ContractStatus | undefined, pageNumber: 1 })
                }
              >
                <option value="">Every status</option>
                {STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            </span>
            {filtered && (
              <Button variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
          </>
        }
      />

      <DataTable<Contract>
        caption="Contracts"
        columns={columns}
        rows={rows}
        rowId={(contract) => contract.id}
        rowLabel={(contract) => contract.code}
        rowHref={(contract) => `/o/contracts/${contract.id}`}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        empty={
          filtered
            ? { title: 'No results match your filters.', action: <Button onClick={clear}>Clear filters</Button> }
            : { title: 'Your organization has no contracts yet.', action: requestLink || undefined }
        }
        rowActions={isManager ? rowActions : undefined}
        renderCard={(contract) => (
          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-2">
              <Link to={`/o/contracts/${contract.id}`} className="font-semibold text-ink hover:underline">
                {contract.code}
              </Link>
              <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>
            </div>
            <p className="text-sm text-ink-muted">
              {planLabel(contract)}, {contract.quantity} devices
            </p>
            {formatNextDate(contract) && <p className="text-sm text-ink-muted">Next date: {formatNextDate(contract)}</p>}
          </div>
        )}
        footer={
          data && data.totalPages > 1 ? (
            <Pagination
              pageNumber={data.pageNumber}
              totalPages={data.totalPages}
              totalItems={data.totalCount}
              pageSize={data.pageSize}
              onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
            />
          ) : undefined
        }
      />

      {cancelling && (
        <StateChangeDialog<'CANCELLED'>
          subject={cancelling.code}
          transition={CANCEL}
          version={cancelling.version}
          onSubmit={({ reason, expectedVersion }) => cancelContract(cancelling.id, reason ?? '', expectedVersion)}
          onReload={refresh}
          onDone={refresh}
          onClose={() => setCancelling(null)}
        />
      )}
    </section>
  );
};
