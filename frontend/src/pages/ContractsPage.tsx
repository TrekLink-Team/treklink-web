import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  nextDateOf,
  planLabel,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type ContractFilters,
  type ContractStatus,
  type PlanType,
} from '../entities/contract/api';
import { formatDate, formatDay } from '../shared/lib/format';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { INPUT, LINK, PRIMARY_BUTTON } from '../shared/ui/styles';

const STATUSES = Object.keys(STATUS_LABELS) as ContractStatus[];

// /o/contracts, the contract list of screen 5.2 (rentals api-design 02). Org Manager and Org
// Operator read it; only the Manager sees Request a contract.
export const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const isManager = hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']);
  const [filters, setFilters] = useState<ContractFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = useContracts('o', filters);
  const filtered = filters.status !== undefined || filters.planType !== undefined;

  return (
    <section aria-labelledby="contracts-title">
      <PageTitle
        id="contracts-title"
        title="Contracts"
        action={
          isManager && (
            <Link to="/o/contracts/new" className={PRIMARY_BUTTON}>
              Request a contract
            </Link>
          )
        }
      />

      <div className="mb-4 flex flex-wrap gap-3">
        <select
          aria-label="Filter by status"
          className={INPUT}
          value={filters.status ?? ''}
          onChange={(event) =>
            setFilters({
              ...filters,
              status: (event.target.value || undefined) as ContractStatus | undefined,
              pageNumber: 1,
            })
          }
        >
          <option value="">All statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by plan"
          className={INPUT}
          value={filters.planType ?? ''}
          onChange={(event) =>
            setFilters({
              ...filters,
              planType: (event.target.value || undefined) as PlanType | undefined,
              pageNumber: 1,
            })
          }
        >
          <option value="">All plans</option>
          <option value="MONTHLY">Monthly</option>
          <option value="DAY">Day plan</option>
        </select>
      </div>

      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && (
        <Empty>
          {filtered ? (
            'No results match your filters.'
          ) : (
            <>
              <p>Your organization has no contracts yet.</p>
              {isManager && (
                <Link to="/o/contracts/new" className={`${LINK} mt-2 inline-block`}>
                  Request a contract
                </Link>
              )}
            </>
          )}
        </Empty>
      )}

      {data && data.items.length > 0 && (
        <>
          <ul className="flex flex-col gap-3 md:hidden">
            {data.items.map((contract) => {
              const next = nextDateOf(contract);
              return (
                <li key={contract.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between">
                    <Link to={`/o/contracts/${contract.id}`} className={LINK}>
                      {contract.code}
                    </Link>
                    <Badge tone={STATUS_TONES[contract.status]}>
                      {STATUS_LABELS[contract.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-700">
                    {planLabel(contract)}, {contract.quantity} devices
                  </p>
                  <p className="text-sm text-slate-700">
                    Next date: {next.iso ? formatDate(next.iso) : formatDay(next.day as string)}
                  </p>
                </li>
              );
            })}
          </ul>
          <table className="hidden w-full overflow-hidden rounded-xl border border-slate-200 bg-white text-sm shadow-sm md:table">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3 text-right">Devices</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Next date</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((contract) => {
                const next = nextDateOf(contract);
                return (
                  <tr key={contract.id} className="border-t border-slate-200">
                    <td className="px-4 py-3">
                      <Link to={`/o/contracts/${contract.id}`} className={LINK}>
                        {contract.code}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{planLabel(contract)}</td>
                    <td className="px-4 py-3 text-right">{contract.quantity}</td>
                    <td className="px-4 py-3">
                      <Badge tone={STATUS_TONES[contract.status]}>
                        {STATUS_LABELS[contract.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      {next.iso ? formatDate(next.iso) : formatDay(next.day as string)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <Pager
            pageNumber={data.pageNumber}
            totalPages={data.totalPages}
            onPage={(pageNumber) => setFilters({ ...filters, pageNumber })}
          />
        </>
      )}
    </section>
  );
};
