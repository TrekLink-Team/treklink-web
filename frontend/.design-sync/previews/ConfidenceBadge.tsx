import { ConfidenceBadge } from '@treklink/ui';

export const Confidence = () => (
  <div className="flex flex-wrap items-center gap-3">
    <ConfidenceBadge confidence="CONFIRMED" />
    <ConfidenceBadge confidence="SUSPECTED" />
  </div>
);

export const InIncidentRow = () => (
  <div className="flex max-w-md items-center justify-between rounded-card border border-line bg-surface px-4 py-3">
    <div>
      <p className="font-semibold text-ink">No movement for 45 min</p>
      <p className="text-body-sm text-ink-muted">TL-0019 · Tà Xùa ridge · 15:42</p>
    </div>
    <ConfidenceBadge confidence="SUSPECTED" />
  </div>
);
