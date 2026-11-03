import React from 'react';
import type { CloseBlocker, CloseCheck, ContractDetail } from '../../entities/contract/api';
import { planLabel } from '../../entities/contract/api';
import { CloseBlockers } from '../../features/close-contract/CloseBlockers';
import {
  formatDate,
  formatDateTime,
  formatDay,
  formatVnd,
  viewerTimeZone,
} from '../../shared/lib/format';
import { Button } from '../../shared/ui/Button';
import { Card, CardHeader } from '../../shared/ui/Card';
import { ErrorState, Fact, Loading } from '../../shared/ui/bits';

const When: React.FC<{ iso: string | null | undefined }> = ({ iso }) =>
  iso ? (
    <time dateTime={iso} title={viewerTimeZone()}>
      {formatDateTime(iso)}
    </time>
  ) : (
    <>Not yet</>
  );

interface Props {
  contract: ContractDetail;
  scope: 'o' | 't';
  variantName: string;
  /** Staff on a handed-over contract not yet closed: rentals api-design 20 (D-092 rule 3). */
  close?: {
    check: CloseCheck | undefined;
    loading: boolean;
    error: unknown;
    retry: () => void;
    onClose: () => void;
    onReportLost: (blocker: Extract<CloseBlocker, { code: 'DEVICE_OUT' }>) => void;
  };
}

/**
 * The Overview tab: the contract's facts and dates (rentals api-design 03), the prices fixed at
 * request, the terms, and for TrekLink Staff the close panel with what still blocks the close.
 */
export const OverviewTab: React.FC<Props> = ({ contract, scope, variantName, close }) => (
  <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="flex min-w-0 flex-col gap-3">
      <Card padding="sm">
        <CardHeader title="Contract" />
        <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-3">
          {scope === 't' && contract.organization && (
            <Fact label="Organization">
              {contract.organization.code}, {contract.organization.legalName}
            </Fact>
          )}
          <Fact label="Plan">{planLabel(contract)}</Fact>
          <Fact label="Devices">
            {contract.quantity} x {variantName}
          </Fact>
          <Fact label="Requested start">{formatDay(contract.requestedStartDate)}</Fact>
          {contract.handoverAppointmentAt && (
            <Fact label="Handover appointment">
              <When iso={contract.handoverAppointmentAt} />
            </Fact>
          )}
          {/* D-092: a request holds its units at once; an unpaid hold ends here (rentals REQ-EVT-17). */}
          {contract.status === 'REQUESTED' && contract.holdExpiresAt && (
            <Fact label="Devices held until">
              <When iso={contract.holdExpiresAt} />
            </Fact>
          )}
          {/* The reservation holds the units from approval to the handover (rentals REQ-EVT-02, REQ-EVT-14). */}
          {contract.status === 'APPROVED' && contract.reservationExpiresAt && (
            <Fact label="Reservation expires">
              <When iso={contract.reservationExpiresAt} />
            </Fact>
          )}
          <Fact label="Handed over">
            <When iso={contract.handedOverAt} />
          </Fact>
          <Fact label="Current term">
            {contract.currentTerm
              ? `Term ${contract.currentTerm.seq}, ${formatDate(contract.currentTerm.startsAt)} to ${formatDate(contract.currentTerm.endsAt)}`
              : 'Not started'}
          </Fact>
          {contract.noticeGivenAt && (
            <Fact label="Notice given">
              <When iso={contract.noticeGivenAt} />
            </Fact>
          )}
          {contract.returnDueAt && (
            <Fact label="Return due">
              <When iso={contract.returnDueAt} />
            </Fact>
          )}
        </dl>
      </Card>

      <Card padding="sm">
        <CardHeader title="Terms" />
        {contract.terms.length === 0 ? (
          <p className="text-body-sm text-ink-muted">No term is open yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-body-sm">
            {contract.terms.map((term) => (
              <li key={term.seq} className="flex flex-wrap justify-between gap-2">
                <span>
                  Term {term.seq}: {formatDateTime(term.startsAt)} to {formatDateTime(term.endsAt)}
                </span>
                <span className="font-semibold">{term.status === 'OPEN' ? 'Open' : 'Closed'}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>

    <div className="flex min-w-0 flex-col gap-3">
      <Card padding="sm">
        <CardHeader title="Prices fixed at request" />
        <dl className="flex flex-col gap-3">
          <Fact label="Monthly price per device">{formatVnd(contract.monthlyUnitPriceVnd)}</Fact>
          <Fact label="Holding fee">{Math.round(contract.holdingFeeRatio * 100)} % of a term</Fact>
          {contract.dayPremium !== null && <Fact label="Day premium">x {contract.dayPremium}</Fact>}
        </dl>
      </Card>

      {close && (
        <Card padding="sm" aria-live="polite">
          <CardHeader title="Close" />
          {close.loading && <Loading />}
          {close.error ? <ErrorState error={close.error} onRetry={close.retry} /> : null}
          {close.check?.canClose ? (
            <>
              <p className="mb-3 text-body-sm text-ink-muted">Nothing blocks the close.</p>
              <Button variant="secondary" onClick={close.onClose}>
                Close contract
              </Button>
            </>
          ) : (
            close.check && <CloseBlockers check={close.check} onReportLost={close.onReportLost} />
          )}
        </Card>
      )}
    </div>
  </div>
);
