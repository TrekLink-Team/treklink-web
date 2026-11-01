import React from 'react';
import { Link } from 'react-router-dom';
import type { CloseBlocker, CloseCheck } from '../../entities/contract/api';
import { formatDateTime, formatVnd } from '../../shared/lib/format';
import { Button } from '../../shared/ui';
import { LINK } from '../../shared/ui/styles';

// The blockers of rentals api-design 20 (REQ-EVT-17, D-092 rule 3) as a list Staff can act on: each
// says what still stops the close and links to where it is resolved. A unit not back offers Report lost
// through `onReportLost`, or its open loss case.
const ResolveLink: React.FC<{ to: string; children: React.ReactNode }> = ({ to, children }) => (
  <Link to={to} className={`${LINK} text-body-sm`}>
    {children}
  </Link>
);

const Action: React.FC<{
  blocker: CloseBlocker;
  contractId: string;
  onReportLost?: (blocker: Extract<CloseBlocker, { code: 'DEVICE_OUT' }>) => void;
}> = ({ blocker, contractId, onReportLost }) => {
  switch (blocker.code) {
    case 'NOT_RETURNED':
      return null;
    case 'DEVICE_OUT':
      if (blocker.lossCase) {
        return (
          <ResolveLink to={`/t/loss-cases/${blocker.lossCase.id}`}>
            Open loss case {blocker.lossCase.code}
          </ResolveLink>
        );
      }
      return onReportLost ? (
        <Button size="sm" variant="danger" onClick={() => onReportLost(blocker)}>
          Report {blocker.assetTag} lost
        </Button>
      ) : null;
    case 'BALANCE_OUTSTANDING':
      return (
        <ResolveLink to={`/t/billing?contractId=${contractId}`}>Open the invoices</ResolveLink>
      );
    case 'DAMAGE_PENDING':
      return <ResolveLink to="/t/damage-charges">Open damage charges</ResolveLink>;
    case 'OPEN_INCIDENTS':
      return <ResolveLink to="/t/incidents">Open incidents</ResolveLink>;
  }
};

const detailOf = (blocker: CloseBlocker): string | null => {
  switch (blocker.code) {
    case 'NOT_RETURNED':
      return blocker.waitsFor ? `Waits for ${formatDateTime(blocker.waitsFor)}.` : null;
    case 'OPEN_INCIDENTS':
      return blocker.incidents.length > 0
        ? blocker.incidents.map((incident) => incident.code).join(', ')
        : null;
    case 'BALANCE_OUTSTANDING':
    case 'DAMAGE_PENDING':
      return formatVnd(blocker.amountVnd);
    default:
      return null;
  }
};

export const CloseBlockers: React.FC<{
  check: CloseCheck;
  onReportLost?: (blocker: Extract<CloseBlocker, { code: 'DEVICE_OUT' }>) => void;
}> = ({ check, onReportLost }) => {
  if (check.blockers.length === 0) return null;
  return (
    <section aria-labelledby={`close-blockers-${check.contractId}`} className="flex flex-col gap-2">
      <h3
        id={`close-blockers-${check.contractId}`}
        className="text-body-sm font-semibold text-ink"
      >
        What still blocks the close
      </h3>
      <ul className="flex flex-col divide-y divide-line rounded-control border border-line">
        {check.blockers.map((blocker, index) => {
          const detail = detailOf(blocker);
          return (
            <li
              key={`${blocker.code}-${index}`}
              className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
            >
              <span className="flex flex-col">
                <span className="text-body-sm text-ink">{blocker.message}</span>
                {detail && <span className="text-body-sm text-ink-muted">{detail}</span>}
              </span>
              <Action
                blocker={blocker}
                contractId={check.contractId}
                onReportLost={onReportLost}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
};
