import React from 'react';
import {
  causeLabel,
  useContractServiceCredits,
  type ServiceCredit,
} from '../../entities/billing/api';
import { DataTable, SERVICE_CREDIT_STATUS, StatusBadge, type Column } from '../../shared/ui';
import { ErrorState } from '../../shared/ui/bits';
import { CARD } from '../../shared/ui/styles';
import { creditAmount, outageText } from './creditText';

// The service credits of one contract (screen 6.5, billing api-design 19): on /t/contracts/:id for
// TrekLink Staff and on /o/contracts/:id for the Org Manager, read only.
export const ServiceCreditsCard: React.FC<{ contractId: string }> = ({ contractId }) => {
  const credits = useContractServiceCredits(contractId, true);
  const columns: Column<ServiceCredit>[] = [
    { key: 'device', header: 'Device', cell: (credit) => credit.assetTag ?? credit.deviceId },
    { key: 'cause', header: 'Cause', cell: (credit) => causeLabel(credit.cause) },
    { key: 'outage', header: 'Outage', cell: outageText },
    { key: 'amount', header: 'Credit', align: 'end', cell: creditAmount },
    {
      key: 'status',
      header: 'Status',
      cell: (credit) => (
        <span className="flex flex-col gap-1">
          <StatusBadge entry={SERVICE_CREDIT_STATUS[credit.status]} />
          {credit.decisionReason && (
            <span className="text-body-sm text-ink-muted">{credit.decisionReason}</span>
          )}
        </span>
      ),
    },
  ];

  return (
    <div className={CARD}>
      <h2 className="mb-3 text-lg font-bold text-ink">Service credits</h2>
      <DataTable
        caption="Service credits of this contract"
        columns={columns}
        rows={credits.data?.items}
        rowId={(credit) => credit.id}
        rowLabel={(credit) => `${credit.assetTag ?? credit.deviceId} ${causeLabel(credit.cause)}`}
        loading={credits.isLoading}
        error={
          credits.error ? (
            <ErrorState error={credits.error} onRetry={() => void credits.refetch()} />
          ) : undefined
        }
        empty={{ title: 'No service credits on this contract.' }}
      />
    </div>
  );
};
