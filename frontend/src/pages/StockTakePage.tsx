import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ScanLine, X } from 'lucide-react';
import {
  STOCK_TAKE_PAGE_SIZE,
  runStockTake,
  stockTakeKeys,
  useStockTakes,
  type StockTakeRun,
  type StockTakeSummary,
} from '../entities/stock-take/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatUtc } from '../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CollectionView,
  ConfirmDialog,
  Field,
  IconButton,
  Input,
  PageHeader,
  Pagination,
  StatusBadge,
  useToast,
  type CollectionField,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { DEVICE_STATUS } from '../shared/ui/status';
import { messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';

const STORAGE_KEY = 'treklink.stockTake.scans';
const RESULT_HEADING = 'stock-take-unconfirmed';

const tagsText = (count: number) => `${count} ${count === 1 ? 'tag' : 'tags'}`;
// The confirmation title of screen 4.5: "Submit {n} scanned tags?".
const scannedTagsText = (count: number) => `${count} scanned ${count === 1 ? 'tag' : 'tags'}`;

// The scan list survives a reload in session storage until it is submitted (screen 4.5). Storage can be
// unavailable (a private window, blocked site data); the page works without it.
const readScans = (): string[] => {
  try {
    const stored = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(stored) ? stored.filter((tag): tag is string => typeof tag === 'string') : [];
  } catch {
    return [];
  }
};
const writeScans = (tags: string[]) => {
  try {
    if (tags.length === 0) sessionStorage.removeItem(STORAGE_KEY);
    else sessionStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  } catch {
    // Storage unavailable: the list lives in memory only.
  }
};

// One collapsible result group with its count in the summary; open by default.
const ResultGroup: React.FC<{
  id: string;
  title: string;
  count: number;
  headingRef?: React.Ref<HTMLHeadingElement>;
  children?: React.ReactNode;
}> = ({ id, title, count, headingRef, children }) => (
  <details open className="rounded-card border border-line bg-surface">
    <summary className="flex min-h-11 cursor-pointer items-center px-4 py-2">
      <h3 id={id} ref={headingRef} tabIndex={-1} className="text-title-sm text-ink outline-none">
        {title} <span className="text-ink-muted">({count})</span>
      </h3>
    </summary>
    {children && <div className="border-t border-line px-4 py-3">{children}</div>}
  </details>
);

const Results: React.FC<{ run: StockTakeRun; onNew: () => void }> = ({ run, onNew }) => {
  const heading = useRef<HTMLHeadingElement>(null);
  // After a submit focus moves to the Unconfirmed heading, the group that needs action (screen 4.5).
  useEffect(() => heading.current?.focus(), [run.id]);
  return (
    <section aria-labelledby="stock-take-result" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="stock-take-result" className="text-title text-ink">
          Result of {formatDateTime(run.createdAt)}
        </h2>
        <Button onClick={onNew}>Start a new stock-take</Button>
      </div>
      <p className="text-body text-ink-muted">{tagsText(run.scannedCount)} scanned.</p>
      <ResultGroup
        id={RESULT_HEADING}
        title="Unconfirmed"
        count={run.unconfirmed.length}
        headingRef={heading}
      >
        {run.unconfirmed.length === 0 ? (
          <p className="text-body text-ink-muted">Every unit was scanned or heard recently.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {run.unconfirmed.map((unit) => (
              <li key={unit.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Link
                  to={`/t/devices/${unit.id}`}
                  className={`${LINK} inline-flex min-h-11 items-center font-mono`}
                >
                  {unit.assetTag}
                </Link>
                <StatusBadge entry={DEVICE_STATUS[unit.status]} />
                <span className="text-body-sm text-ink-muted">
                  {unit.lastSeenAt ? (
                    <span title={formatUtc(unit.lastSeenAt)}>Last heard {formatDateTime(unit.lastSeenAt)}</span>
                  ) : (
                    'Never heard'
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </ResultGroup>
      <ResultGroup id="stock-take-unknown" title="Unknown tags" count={run.unknownTags.length}>
        {run.unknownTags.length > 0 && (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-wrap gap-2">
              {run.unknownTags.map((tag) => (
                <li key={tag} className="rounded-control border border-line px-2 py-1 font-mono text-body-sm text-ink">
                  {tag}
                </li>
              ))}
            </ul>
            <p className="text-body-sm text-ink-muted">
              Not in the register.{' '}
              <Link to="/t/fleet" className={LINK}>
                Register a device on the Devices page
              </Link>
            </p>
          </div>
        )}
      </ResultGroup>
      <ResultGroup id="stock-take-confirmed" title="In stock, confirmed by scan" count={run.inStockConfirmed} />
      <ResultGroup id="stock-take-rented" title="Rented and heard recently" count={run.rentedSeen} />
    </section>
  );
};

// `/t/stock-take`, screen 4.5 (devices api-design 25 and 26, UC-54, FR-DEV-10): Staff scan or type the
// asset tags on the shelf, then Finish compares them with the fleet. TrekLink Staff and Admin.
export const StockTakePage: React.FC = () => {
  const queryClient = useQueryClient();
  const showToast = useToast((state) => state.show);
  const [scans, setScans] = useState<string[]>(readScans);
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | undefined>();
  const [announcement, setAnnouncement] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [run, setRun] = useState<StockTakeRun | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const scanField = useRef<HTMLInputElement>(null);
  const past = useStockTakes(pageNumber);

  useEffect(() => writeScans(scans), [scans]);

  const failure = past.error;
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  // Enter adds the tag: trimmed and upper-cased, a duplicate ignored with a note. Focus stays in the
  // field so a barcode scanner, which types and presses Enter, can feed it.
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const tag = typed.trim().toUpperCase();
    setTyped('');
    if (tag === '') return;
    if (scans.includes(tag)) {
      setNote(`${tag}: Already scanned`);
      setAnnouncement(`${tag} already scanned`);
      return;
    }
    const next = [tag, ...scans];
    setScans(next);
    setNote(undefined);
    setError(undefined);
    setAnnouncement(`${tag} added, ${next.length} scanned`);
  };

  const remove = (tag: string) => {
    const next = scans.filter((item) => item !== tag);
    setScans(next);
    setAnnouncement(`${tag} removed, ${next.length} scanned`);
    scanField.current?.focus();
  };

  const finish = async () => {
    setSubmitting(true);
    try {
      const result = await runStockTake([...scans].reverse());
      setConfirming(false);
      setSubmitting(false);
      setScans([]);
      setRun(result);
      showToast('Saved.');
      setPageNumber(1);
      void queryClient.invalidateQueries({ queryKey: stockTakeKeys.all });
    } catch (problem) {
      setConfirming(false);
      setSubmitting(false);
      setError(messageOf(problem));
    }
  };

  const fields: CollectionField<StockTakeSummary>[] = [
    { key: 'takenBy', label: 'Taken by', render: (row) => row.takenBy ?? 'Unknown account', compact: true },
    { key: 'scannedCount', label: 'Scanned', render: (row) => String(row.scannedCount), align: 'end' },
    // Compact, so it also shows on the 360 px card, where the number needs its word.
    { key: 'unconfirmedCount', label: 'Unconfirmed', render: (row) => `${row.unconfirmedCount} unconfirmed`, align: 'end', compact: true },
    { key: 'unknownCount', label: 'Unknown tags', render: (row) => String(row.unknownCount), align: 'end' },
  ];

  const data = past.data;

  return (
    <section aria-labelledby="stock-take-title" className="flex flex-col gap-4 pb-20 md:pb-0">
      <PageHeader
        id="stock-take-title"
        title="Stock-take"
        description="Scan every unit on the shelf, then finish to see which units are unconfirmed."
      />

      {run ? (
        <Results
          run={run}
          onNew={() => {
            setRun(null);
            setTimeout(() => scanField.current?.focus(), 0);
          }}
        />
      ) : (
        <Card>
          <CardHeader
            title="Scan"
            id="stock-take-scan"
            action={<span className="text-body text-ink-muted">{scans.length} scanned</span>}
          />
          <form onSubmit={add} className="flex flex-col gap-2">
            <Field
              id="stock-take-tag"
              label="Asset tag"
              hint="Scan the label or type the tag, then press Enter."
              error={note}
            >
              <Input
                id="stock-take-tag"
                ref={scanField}
                value={typed}
                // The scan field takes focus on arrival, as the screen asks: a scanner types into it at once.
                autoFocus
                autoComplete="off"
                disabled={submitting}
                placeholder="TL-0042"
                onChange={(event) => setTyped(event.target.value)}
              />
            </Field>
          </form>
          <p aria-live="polite" className="sr-only">
            {announcement}
          </p>
          {error && (
            <Alert tone="error" className="mt-3">
              {error}
            </Alert>
          )}
          {scans.length === 0 ? (
            <p className="mt-4 text-body text-ink-muted">Scan a device&apos;s asset tag to start.</p>
          ) : (
            <ul aria-label="Scanned tags" className="mt-4 flex max-h-80 flex-col divide-y divide-line overflow-y-auto">
              {scans.map((tag) => (
                <li key={tag} className="flex items-center justify-between gap-2 py-1">
                  <span className="font-mono text-body text-ink">{tag}</span>
                  <IconButton
                    label={`Remove ${tag}`}
                    icon={<X aria-hidden="true" className="h-4 w-4" />}
                    size="lg"
                    onClick={() => remove(tag)}
                  />
                </li>
              ))}
            </ul>
          )}
          <div className="fixed inset-x-0 bottom-[calc(theme(spacing.tabbar)+env(safe-area-inset-bottom))] z-raised border-t border-line bg-surface p-3 md:static md:mt-4 md:border-0 md:bg-transparent md:p-0">
            <Button
              variant="primary"
              icon={<ScanLine aria-hidden="true" className="h-4 w-4" />}
              className="min-h-11 w-full md:w-auto"
              loading={submitting}
              disabled={scans.length === 0}
              onClick={() => setConfirming(true)}
            >
              Finish stock-take
            </Button>
          </div>
        </Card>
      )}

      <section aria-labelledby="past-stock-takes" className="flex flex-col gap-2">
        <h2 id="past-stock-takes" className="text-title text-ink">
          Past stock-takes
        </h2>
        <CollectionView<StockTakeSummary>
          label="Past stock-takes"
          items={data?.items}
          loading={past.isPending}
          error={failure ? <ErrorState error={failure} onRetry={() => void past.refetch()} /> : undefined}
          itemId={(row) => row.id}
          itemName={(row) => formatDateTime(row.createdAt)}
          itemTitle={(row) => <span title={formatUtc(row.createdAt)}>{formatDateTime(row.createdAt)}</span>}
          fields={fields}
          noun={{ one: 'stock-take', other: 'stock-takes' }}
          details={false}
          hideCommandBar
          emptyState={{ title: 'No stock-takes yet.' }}
          footer={
            data && data.totalPages > 1 ? (
              <Pagination
                pageNumber={data.pageNumber}
                totalPages={data.totalPages}
                totalItems={data.totalCount}
                pageSize={STOCK_TAKE_PAGE_SIZE}
                onPage={setPageNumber}
              />
            ) : undefined
          }
        />
      </section>

      {confirming && (
        <ConfirmDialog
          titleId="stock-take-confirm-title"
          title={`Submit ${scannedTagsText(scans.length)}?`}
          description="Units not scanned and not heard recently are listed as unconfirmed."
          confirmLabel="Finish stock-take"
          pending={submitting}
          onConfirm={() => void finish()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </section>
  );
};
