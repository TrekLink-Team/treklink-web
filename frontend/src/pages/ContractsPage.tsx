import React, { useState } from 'react';
import { FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../app/providers/useAuth';
import {
  cancelContract,
  CONTRACT_SORT_FIELDS,
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
import { collectionSortOf, sortParamsOf } from '../shared/api/query';
import { hasAnyRole } from '../shared/lib/permissions';
import { matchesText } from '../shared/lib/filter';
import {
  CollectionView,
  Pagination,
  pageInfoOf,
  StateChangeDialog,
  type CollectionField,
  type CollectionTransition,
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

// /o/contracts, the contract list of screen 5.2 (rentals api-design 02) on CollectionView (chapter 06
// §9, D-096). Org Manager and Org Operator read it; only the Manager sees Request a contract and
// Cancel contract, a status change before handover (W29, §9.6). The status and the plan filter on the
// server and combine in Show (rentals api-design 02 `status`, `planType`). The search still reads the
// loaded page by code and plan, as the list did before CollectionView; rentals 02 `q` (REQ-EVT-26) is
// sent by the Staff contracts page only.
export const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isManager = hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']);
  const [filters, setFilters] = useState<ContractFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = useContracts('o', filters);
  const [text, setText] = useState('');
  const [cancelling, setCancelling] = useState<Contract | null>(null);
  const rows = data?.items.filter((contract) => matchesText(text, contract.code, planLabel(contract)));
  const refresh = () => void queryClient.invalidateQueries({ queryKey: contractKeys.all });

  const requestLink = isManager && (
    <Link to="/o/contracts/new" className={PRIMARY_BUTTON}>
      Request a contract
    </Link>
  );

  const fields: CollectionField<Contract>[] = [
    { key: 'plan', label: 'Plan', render: planLabel, compact: true },
    { key: 'quantity', label: 'Devices', align: 'end', render: (contract) => contract.quantity, sortable: true },
    {
      key: 'status',
      label: 'Status',
      render: (contract) => <Badge tone={STATUS_TONES[contract.status]}>{STATUS_LABELS[contract.status]}</Badge>,
      compact: true,
      sortable: true,
    },
    { key: 'next', label: 'Next date', render: (contract) => formatNextDate(contract), compact: true },
  ];

  const transitions = (contract: Contract): CollectionTransition<Contract>[] =>
    isManager && (contract.status === 'REQUESTED' || contract.status === 'APPROVED')
      ? [{ key: 'cancel', label: 'Cancel contract', destructive: true, onSelect: () => setCancelling(contract) }]
      : [];

  return (
    <section aria-labelledby="contracts-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
      <PageTitle id="contracts-title" title="Contracts" action={requestLink} />

      <CollectionView<Contract>
        icon={<FileText />}
        label="Contracts"
        items={rows}
        loading={isLoading}
        error={error ? <ErrorState error={error} onRetry={() => void refetch()} /> : undefined}
        itemId={(contract) => contract.id}
        itemName={(contract) => contract.code}
        itemHref={(contract) => `/o/contracts/${contract.id}`}
        fields={fields}
        noun={{ one: 'contract', other: 'contracts' }}
        transitions={isManager ? transitions : undefined}
        status={{
          field: 'status',
          value: (contract) => ({ label: STATUS_LABELS[contract.status], tone: STATUS_TONES[contract.status] }),
        }}
        search={{ label: 'Search by contract code or plan', placeholder: 'RC-... or Monthly' }}
        filters={[
          { key: '', label: 'Every status' },
          ...STATUSES.map((status) => ({ key: status, label: STATUS_LABELS[status] })),
        ]}
        query={{
          search: text,
          filter: filters.status ?? '',
          sort: collectionSortOf(filters),
          groups: { plan: filters.planType ?? '' },
        }}
        titleSort="code"
        onQueryChange={(next) => {
          setText(next.search);
          const status = (next.filter || undefined) as ContractStatus | undefined;
          const planType = (next.groups?.plan || undefined) as PlanType | undefined;
          const sort = sortParamsOf(next.sort, CONTRACT_SORT_FIELDS);
          if (
            status !== filters.status ||
            planType !== filters.planType ||
            sort.sort !== filters.sort ||
            sort.order !== filters.order
          )
            setFilters({ status, planType, ...sort, pageNumber: 1 });
        }}
        filterGroups={[
          {
            key: 'plan',
            label: 'Plan',
            options: [
              { key: '', label: 'Every plan' },
              { key: 'MONTHLY', label: 'Monthly' },
              { key: 'DAY', label: 'Day plan' },
            ],
          },
        ]}
        pageInfo={pageInfoOf(data)}
        details={{ href: (contract) => `/o/contracts/${contract.id}`, hrefLabel: 'Open the contract' }}
        emptyState={{ title: 'Your organization has no contracts yet.', action: requestLink || undefined }}
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
