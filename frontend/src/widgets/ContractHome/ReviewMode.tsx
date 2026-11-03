import React, { useState } from 'react';
import {
  approveContract,
  planLabel,
  useAvailability,
  type Approved,
  type ContractDetail,
} from '../../entities/contract/api';
import { ApiError } from '../../shared/api/apiClient';
import { formatDateTime, formatDay, formatVnd } from '../../shared/lib/format';
import { Alert } from '../../shared/ui/Alert';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { Field, Input } from '../../shared/ui/Field';
import { useToast } from '../../shared/ui/toastStore';

export const REVIEW_FORM_ID = 'contract-review-form';

// The appointment starts on the requested start date at 09:00, the counter's opening hour, in the
// viewer's local time (screen 5.3).
const appointmentOf = (day: string) => `${day}T09:00`;

interface Props {
  contract: ContractDetail;
  variantName: string;
  onPending: (pending: boolean) => void;
  /** After approval, or when the server says the request already moved on. */
  onDecided: (approved: Approved | null) => void;
  onReload: () => void;
}

/**
 * Review mode of the contract home (`?mode=review`, chapter 06 §10.4) in place of the tab body: the
 * request, the hold or stock check, the handover appointment and what each decision does. Approve
 * request in the sticky bar submits this form (rentals api-design 04); Reject and Cancel are in More
 * actions behind a Dialog. The rules are screen 5.3's, moved here.
 */
export const ReviewMode: React.FC<Props> = ({
  contract,
  variantName,
  onPending,
  onDecided,
  onReload,
}) => {
  const showToast = useToast((state) => state.show);
  const [appointment, setAppointment] = useState(appointmentOf(contract.requestedStartDate));
  const [failure, setFailure] = useState<{
    message: string;
    field: boolean;
    stale: boolean;
  } | null>(null);
  // Since D-092 a request holds its units from the moment it is sent, and approval keeps them; only a
  // request sent before D-092 (no holdExpiresAt) is reserved at approval and needs the count.
  const held = Boolean(contract.holdExpiresAt);
  const [openedAt] = useState(() => Date.now());
  const availability = useAvailability(contract.hardwareVariant.id, !held);
  const available = availability.data?.find(
    (row) => row.hardwareVariantId === contract.hardwareVariant.id,
  )?.available;
  const holdOpen = contract.holdExpiresAt
    ? new Date(contract.holdExpiresAt).getTime() > openedAt
    : false;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (appointment === '') {
      setFailure({ message: 'Handover appointment is required.', field: true, stale: false });
      return;
    }
    setFailure(null);
    onPending(true);
    try {
      const result = await approveContract(
        contract.id,
        new Date(appointment).toISOString(),
        contract.version,
      );
      showToast(`${contract.code} approved. ${result.devices.length} devices reserved.`);
      onDecided(result);
    } catch (error) {
      const api = error instanceof ApiError ? error : null;
      setFailure({
        message: api?.message ?? 'Something went wrong. Please try again.',
        field: api?.errorCode === 'VALIDATION_FAILED',
        stale: api?.errorCode === 'STALE_VERSION',
      });
      if (api?.errorCode === 'INVALID_STATE_TRANSITION') onDecided(null);
    } finally {
      onPending(false);
    }
  };

  const facts: [string, string][] = [
    ...(contract.organization
      ? [
          ['Organization', `${contract.organization.code}, ${contract.organization.legalName}`] as [
            string,
            string,
          ],
        ]
      : []),
    ['Plan', planLabel(contract)],
    ['Units', `${contract.quantity} x ${variantName}`],
    ['Requested start', formatDay(contract.requestedStartDate)],
    ['Monthly price per device', `${formatVnd(contract.monthlyUnitPriceVnd)}, fixed at request`],
    ['Holding fee', `${Math.round(contract.holdingFeeRatio * 100)} % of a term`],
    ...(contract.dayPremium !== null
      ? [['Day premium', `x ${contract.dayPremium}, fixed at request`] as [string, string]]
      : []),
    ...(contract.holdExpiresAt
      ? [['Hold expires', formatDateTime(contract.holdExpiresAt)] as [string, string]]
      : []),
  ];

  return (
    <section aria-label="Review request" className="grid items-start gap-3 lg:grid-cols-2">
      <Card padding="sm">
        <CardHeader title="The request" />
        <dl className="grid grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
          {facts.map(([label, value]) => (
            <React.Fragment key={label}>
              <dt className="text-body-sm text-ink-muted">{label}</dt>
              <dd className="text-body tabular-nums text-ink">{value}</dd>
            </React.Fragment>
          ))}
        </dl>
      </Card>

      <div className="flex min-w-0 flex-col gap-3">
        <Card padding="sm">
          <CardHeader title={held ? 'Units held' : 'Stock check'} />
          {held ? (
            holdOpen ? (
              <Alert tone="success">
                {`This request holds its ${contract.quantity} ${variantName} units; approval keeps them. An unpaid hold ends ${formatDateTime(contract.holdExpiresAt ?? '')}.`}
              </Alert>
            ) : (
              <Alert tone="warning">
                {`The hold of this request ended ${formatDateTime(contract.holdExpiresAt ?? '')}. If the deposit is unpaid, approval is refused and the request is cancelled shortly; a paid deposit keeps the units.`}
              </Alert>
            )
          ) : (
            <Alert
              tone={
                available === undefined
                  ? 'info'
                  : available < contract.quantity
                    ? 'warning'
                    : 'success'
              }
            >
              {availability.isLoading
                ? 'Checking availability…'
                : available === undefined
                  ? 'Availability is unknown; approval checks it.'
                  : available < contract.quantity
                    ? `Only ${available} ${variantName} available now.`
                    : `${available} ${variantName} available now; approval reserves ${contract.quantity}.`}
            </Alert>
          )}
        </Card>

        <Card padding="sm">
          <CardHeader title="Handover appointment" />
          <form
            id={REVIEW_FORM_ID}
            noValidate
            onSubmit={(event) => void submit(event)}
            className="flex flex-col gap-3"
          >
            {failure && !failure.field && (
              <Alert
                tone="error"
                title="The approval was refused"
                action={
                  failure.stale ? (
                    <Button size="sm" onClick={onReload}>
                      Reload
                    </Button>
                  ) : undefined
                }
              >
                {failure.message}
              </Alert>
            )}
            <Field
              id="review-appointment"
              label="Handover appointment"
              hint="The server reserves the units, the longest unused first."
              error={failure?.field ? failure.message : undefined}
            >
              <Input
                id="review-appointment"
                type="datetime-local"
                value={appointment}
                invalid={Boolean(failure?.field)}
                onChange={(event) => {
                  setAppointment(event.target.value);
                  if (failure?.field) setFailure(null);
                }}
              />
            </Field>
          </form>
        </Card>

        <Card padding="sm">
          <CardHeader title="What each decision does" />
          <dl className="flex flex-col gap-2">
            <div>
              <dt className="text-body font-semibold text-ink">Approve request</dt>
              <dd className="text-body-sm text-ink-muted">
                Keeps the held units reserved for the handover at the appointment above.
              </dd>
            </div>
            <div>
              <dt className="text-body font-semibold text-ink">Reject request, in More actions</dt>
              <dd className="text-body-sm text-ink-muted">
                Closes the request as Rejected after a confirmation with a reason the Manager sees.
                The held units go back to stock.
              </dd>
            </div>
          </dl>
        </Card>
      </div>
    </section>
  );
};
