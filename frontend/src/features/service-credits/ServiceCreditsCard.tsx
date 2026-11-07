import React from 'react';
import { Undo2 } from 'lucide-react';
import {
  creditCauseLabel,
  useContractServiceCredits,
  type ServiceCredit,
} from '../../entities/billing/api';
import {
  CollectionView,
  SERVICE_CREDIT_STATUS,
  StatusBadge,
  type CollectionField,
} from '../../shared/ui';
import { ErrorState } from '../../shared/ui/bits';
import { CARD } from '../../shared/ui/styles';
import { creditAmount, outageText } from './creditText';

const deviceOf = (credit: ServiceCredit) => credit.assetTag ?? credit.deviceId;

const FIELDS: CollectionField<ServiceCredit>[] = [
  { key: 'cause', label: 'Cause', render: (credit) => creditCauseLabel(credit), compact: true },
  { key: 'outage', label: 'Outage', render: outageText, hideWithPane: true },
  { key: 'amount', label: 'Credit', align: 'end', render: creditAmount, compact: true },
  {
    key: 'status',
    label: 'Status',
    render: (credit) => <StatusBadge entry={SERVICE_CREDIT_STATUS[credit.status]} />,
    text: (credit) => SERVICE_CREDIT_STATUS[credit.status].label,
    compact: true,
  },
  {
    key: 'reason',
    label: 'Decision reason',
    render: (credit) => credit.decisionReason ?? 'None',
    text: (credit) => credit.decisionReason ?? '',
    hideWithPane: true,
  },
];

// The service credits of one contract (screen 6.5, billing api-design 19): on /t/contracts/:id for
// TrekLink Staff and on /o/contracts/:id for the Org Manager, read only, on CollectionView (chapter 06
// §9, D-096). Each credit is named by its device and cause.
export const ServiceCreditsCard: React.FC<{ contractId: string }> = ({ contractId }) => {
  const credits = useContractServiceCredits(contractId, true);

  return (
    <div className={CARD}>
      <h2 className="mb-3 text-lg font-bold text-ink">Service credits</h2>
      <CollectionView<ServiceCredit>
        icon={<Undo2 />}
        label="Service credits of this contract"
        items={credits.data?.items}
        loading={credits.isLoading}
        error={
          credits.error ? (
            <ErrorState error={credits.error} onRetry={() => void credits.refetch()} />
          ) : undefined
        }
        itemId={(credit) => credit.id}
        itemName={(credit) => `${deviceOf(credit)} ${creditCauseLabel(credit)}`}
        itemTitle={(credit) => <span className="font-mono text-ink">{deviceOf(credit)}</span>}
        fields={FIELDS}
        noun={{ one: 'credit', other: 'credits' }}
        filters={[
          { key: 'all', label: 'All statuses' },
          ...(Object.keys(SERVICE_CREDIT_STATUS) as ServiceCredit['status'][]).map((key) => ({
            key,
            label: SERVICE_CREDIT_STATUS[key].label,
            test: (credit: ServiceCredit) => credit.status === key,
          })),
        ]}
        fitNarrow
        emptyState={{ title: 'No service credits on this contract.' }}
        noMatch={{ title: 'No credit has this status.' }}
      />
    </div>
  );
};
