import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../app/providers/useAuth';
import {
  formatNextDate,
  planLabel,
  STATUS_LABELS,
  STATUS_TONES,
  useContracts,
  type ContractFilters,
  type ContractStatus,
  type PlanType,
} from '../entities/contract/api';
import { hasAnyRole } from '../shared/lib/permissions';
import { Badge, Empty, ErrorState, Loading, PageTitle, Pager } from '../shared/ui/bits';
import { LINK, PRIMARY_BUTTON } from '../shared/ui/styles';
import { matchesText } from '../shared/lib/filter';
import { FilterBar, FilterRow, NoMatchRow, type FilterField } from '../shared/ui/TableFilters';

const STATUSES = Object.keys(STATUS_LABELS) as ContractStatus[];

// /o/contracts, the contract list of screen 5.2 (rentals api-design 02). Org Manager and Org
// Operator read it; only the Manager sees Request a contract.
export const ContractsPage: React.FC = () => {
  const { user } = useAuth();
  const isManager = hasAnyRole(user?.roles ?? [], ['ORG_MANAGER']);
  const [filters, setFilters] = useState<ContractFilters>({ pageNumber: 1 });
  const { data, isLoading, error, refetch } = useContracts('o', filters);
  const [code, setCode] = useState('');
  const filtered = filters.status !== undefined || filters.planType !== undefined || code !== '';
  const rows = data?.items.filter((contract) => matchesText(code, contract.code)) ?? [];
  const clear = () => {
    setCode('');
    setFilters({ pageNumber: 1 });
  };
  const fields: Record<'code' | 'plan' | 'status', FilterField> = {
    code: { label: 'code', kind: 'text', value: code, onChange: setCode, placeholder: 'RC-...' },
    plan: {
      label: 'plan',
      kind: 'select',
      value: filters.planType ?? '',
      options: [
        { value: 'MONTHLY', label: 'Monthly' },
        { value: 'DAY', label: 'Day plan' },
      ],
      onChange: (value) =>
        setFilters({
          ...filters,
          planType: (value || undefined) as PlanType | undefined,
          pageNumber: 1,
        }),
    },
    status: {
      label: 'status',
      kind: 'select',
      value: filters.status ?? '',
      options: STATUSES.map((status) => ({ value: status, label: STATUS_LABELS[status] })),
      onChange: (value) =>
        setFilters({
          ...filters,
          status: (value || undefined) as ContractStatus | undefined,
          pageNumber: 1,
        }),
    },
  };

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

      {isLoading && <Loading />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {data && data.items.length === 0 && !filtered && (
        <Empty>
          <p>Your organization has no contracts yet.</p>
          {isManager && (
            <Link to="/o/contracts/new" className={`${LINK} mt-2 inline-block`}>
              Request a contract
            </Link>
          )}
        </Empty>
      )}

      {data && (data.items.length > 0 || filtered) && (
        <>
          <FilterBar
            className="mb-3 md:hidden"
            fields={[fields.code, fields.plan, fields.status]}
            onClear={clear}
          />
          <ul className="flex flex-col gap-3 md:hidden">
            {rows.length === 0 && <li className="text-slate-700">No rows match these filters.</li>}
            {rows.map((contract) => {
              const next = formatNextDate(contract);
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
                  {next && <p className="text-sm text-ink-muted">Next date: {next}</p>}
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
              <FilterRow
                columns={[fields.code, fields.plan, null, fields.status, null]}
                onClear={clear}
              />
            </thead>
            <tbody>
              {rows.length === 0 && <NoMatchRow colSpan={5} onClear={clear} />}
              {rows.map((contract) => {
                const next = formatNextDate(contract);
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
                    <td className="px-4 py-3">{next}</td>
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
