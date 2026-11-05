import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PageScrollBody } from '../shared/ui/PageChrome';
import {
  fetchReportCsv,
  REPORT_KINDS,
  useReport,
  type IncidentTimesRow,
  type LostRow,
  type OverdueRow,
  type ReportKind,
  type RevenueRow,
  type UtilizationRow,
} from '../entities/report/api';
import {
  addDays,
  csvName,
  defaultIncidentRow,
  durationText,
  incidentRowName,
  isDay,
  isReportKind,
  KIND_LABEL,
  lastDaysPeriod,
  monthPeriod,
  periodError,
  revenueTotals,
  type Period,
} from '../entities/report/model';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime, formatDay, formatTime, formatVnd } from '../shared/lib/format';
import {
  Alert,
  Button,
  Card,
  CardHeader,
  CollectionView,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatCard,
  TabPanel,
  Tabs,
  type CollectionField,
  type Column,
} from '../shared/ui';
import { ErrorState } from '../shared/ui/bits';
import { invalid, messageOf } from '../shared/ui/errors';
import { LINK } from '../shared/ui/styles';
import { BarChart } from '../widgets/BarChart/BarChart';

const DOWNLOADED_MS = 3000;

const TAB_ITEMS = REPORT_KINDS.map((kind) => ({ key: kind, label: KIND_LABEL[kind] }));

const number = (value: number): string => new Intl.NumberFormat('en-US').format(value);

// The chart of a tab: always on a wide screen, behind a button on a phone, where the table is the main view.
const ChartBox: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <Button
        variant="secondary"
        size="sm"
        className="mb-3 sm:hidden"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
      >
        {open ? 'Hide chart' : 'Show chart'}
      </Button>
      <div className={open ? 'block' : 'hidden sm:block'}>{children}</div>
    </div>
  );
};

const VARIANT_NONE = 'No variant';
const variantOf = (variant: string | null): string => variant ?? VARIANT_NONE;

const UtilizationPanel: React.FC<{ rows: UtilizationRow[] }> = ({ rows }) => {
  const columns: Column<UtilizationRow>[] = [
    { key: 'variant', header: 'Variant', cell: (row) => variantOf(row.variant) },
    { key: 'units', header: 'Units in service', cell: (row) => row.unitsInService, align: 'end' },
    {
      key: 'rented',
      header: 'Rented unit-days',
      cell: (row) => number(row.rentedUnitDays),
      align: 'end',
    },
    {
      key: 'available',
      header: 'Available unit-days',
      cell: (row) => number(row.availableUnitDays),
      align: 'end',
    },
    {
      key: 'pct',
      header: 'Utilization (%)',
      cell: (row) => `${row.utilizationPct} %`,
      align: 'end',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 && (
        <ChartBox>
          <BarChart
            groups={rows.map((row) => ({
              label: variantOf(row.variant),
              values: [row.utilizationPct],
            }))}
            series={[{ name: 'Utilization', fill: 'bg-brand' }]}
            max={100}
            format={(value) => `${value} %`}
            alternative={`Utilization by variant: ${rows
              .map((row) => `${variantOf(row.variant)} ${row.utilizationPct} %`)
              .join(', ')}`}
          />
        </ChartBox>
      )}
      <ReportTable
        caption="Utilization by variant"
        columns={columns}
        rows={rows}
        rowId={(row) => variantOf(row.variant)}
        card={(row) => (
          <Pairs
            title={variantOf(row.variant)}
            pairs={[
              ['Units in service', row.unitsInService],
              ['Rented unit-days', number(row.rentedUnitDays)],
              ['Available unit-days', number(row.availableUnitDays)],
              ['Utilization', `${row.utilizationPct} %`],
            ]}
          />
        )}
      />
    </div>
  );
};

type RevenueLine = RevenueRow & { total?: boolean };

const RevenuePanel: React.FC<{ rows: RevenueRow[] }> = ({ rows }) => {
  const lines: RevenueLine[] =
    rows.length > 0 ? [...rows, { variant: 'Total', ...revenueTotals(rows), total: true }] : [];
  const bold = (row: RevenueLine, text: string) => (row.total ? <strong>{text}</strong> : text);
  const columns: Column<RevenueLine>[] = [
    { key: 'variant', header: 'Variant', cell: (row) => bold(row, variantOf(row.variant)) },
    {
      key: 'invoiced',
      header: 'Invoiced',
      cell: (row) => bold(row, formatVnd(row.invoicedVnd)),
      align: 'end',
    },
    { key: 'paid', header: 'Paid', cell: (row) => bold(row, formatVnd(row.paidVnd)), align: 'end' },
    {
      key: 'outstanding',
      header: 'Outstanding',
      cell: (row) => bold(row, formatVnd(row.outstandingVnd)),
      align: 'end',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {rows.length > 0 && (
        <ChartBox>
          <BarChart
            groups={rows.map((row) => ({
              label: variantOf(row.variant),
              values: [row.invoicedVnd, row.paidVnd],
            }))}
            series={[
              { name: 'Invoiced', fill: 'bg-brand' },
              { name: 'Paid', fill: 'bg-status-done-strong' },
            ]}
            format={formatVnd}
            alternative={`Revenue by variant: ${rows
              .map(
                (row) =>
                  `${variantOf(row.variant)} invoiced ${formatVnd(row.invoicedVnd)}, paid ${formatVnd(row.paidVnd)}`,
              )
              .join('; ')}`}
          />
        </ChartBox>
      )}
      <ReportTable
        caption="Revenue by variant"
        columns={columns}
        rows={lines}
        rowId={(row) => variantOf(row.variant)}
        card={(row) => (
          <Pairs
            title={variantOf(row.variant)}
            pairs={[
              ['Invoiced', formatVnd(row.invoicedVnd)],
              ['Paid', formatVnd(row.paidVnd)],
              ['Outstanding', formatVnd(row.outstandingVnd)],
            ]}
          />
        )}
      />
    </div>
  );
};

const OverduePanel: React.FC<{ rows: OverdueRow[] }> = ({ rows }) => {
  const code = (row: OverdueRow) => (
    <Link to={`/t/contracts/${row.contractId}`} className={LINK}>
      {row.contractCode}
    </Link>
  );
  const columns: Column<OverdueRow>[] = [
    { key: 'code', header: 'Contract', cell: code },
    { key: 'organization', header: 'Organization', cell: (row) => row.organization },
    { key: 'end', header: 'End date', cell: (row) => formatDay(row.endDate) },
    { key: 'days', header: 'Days overdue', cell: (row) => row.daysOverdue, align: 'end' },
    { key: 'units', header: 'Units out', cell: (row) => row.unitsOut, align: 'end' },
    { key: 'fee', header: 'Late fee', cell: (row) => formatVnd(row.lateFeeVnd), align: 'end' },
    { key: 'state', header: 'State', cell: (row) => row.state },
  ];
  return (
    <ReportTable
      caption="Overdue contracts"
      columns={columns}
      rows={rows}
      rowId={(row) => row.contractId}
      rowName={(row) => row.contractCode}
      card={(row) => (
        <Pairs
          title={code(row)}
          pairs={[
            ['Organization', row.organization],
            ['End date', formatDay(row.endDate)],
            ['Days overdue', row.daysOverdue],
            ['Units out', row.unitsOut],
            ['Late fee', formatVnd(row.lateFeeVnd)],
            ['State', row.state],
          ]}
        />
      )}
    />
  );
};

const LostPanel: React.FC<{ rows: LostRow[] }> = ({ rows }) => {
  const tag = (row: LostRow) =>
    row.lossCaseId ? (
      <Link to={`/t/loss-cases/${row.lossCaseId}`} className={LINK}>
        {row.assetTag ?? 'Unit'}
      </Link>
    ) : (
      <span>{row.assetTag ?? 'Unknown'}</span>
    );
  const contract = (row: LostRow) => (
    <Link to={`/t/contracts/${row.contractId}`} className={LINK}>
      {row.contractCode}
    </Link>
  );
  const columns: Column<LostRow>[] = [
    { key: 'tag', header: 'Asset tag', cell: tag },
    { key: 'variant', header: 'Variant', cell: (row) => variantOf(row.variant) },
    { key: 'organization', header: 'Organization', cell: (row) => row.organization },
    { key: 'contract', header: 'Contract', cell: contract },
    { key: 'lostAt', header: 'Lost at', cell: (row) => formatDateTime(row.lostAt) },
    { key: 'state', header: 'Loss case', cell: (row) => row.lossCaseState ?? 'None' },
    {
      key: 'charge',
      header: 'Charge',
      cell: (row) => (row.chargeVnd === null ? '–' : formatVnd(row.chargeVnd)),
      align: 'end',
    },
  ];
  return (
    <ReportTable
      caption="Lost units"
      columns={columns}
      rows={rows}
      rowId={(row) => `${row.contractId}-${row.assetTag ?? row.lostAt}`}
      rowName={(row) => row.assetTag ?? `Unit of ${row.contractCode}`}
      card={(row) => (
        <Pairs
          title={tag(row)}
          pairs={[
            ['Variant', variantOf(row.variant)],
            ['Organization', row.organization],
            ['Contract', contract(row)],
            ['Lost at', formatDateTime(row.lostAt)],
            ['Loss case', row.lossCaseState ?? 'None'],
            ['Charge', row.chargeVnd === null ? '–' : formatVnd(row.chargeVnd)],
          ]}
        />
      )}
    />
  );
};

const IncidentTimesPanel: React.FC<{ rows: IncidentTimesRow[] }> = ({ rows }) => {
  // The tiles show the chosen row; until one is chosen, the row over every incident of the period.
  const [chosen, setChosen] = useState<string | null>(null);
  const selected = rows.find((row) => incidentRowName(row) === chosen) ?? defaultIncidentRow(rows);
  const name = (row: IncidentTimesRow) => incidentRowName(row);
  const pick = (row: IncidentTimesRow) => (
    <button
      type="button"
      className={LINK}
      aria-pressed={selected === row}
      onClick={() => setChosen(name(row))}
    >
      {name(row)}
    </button>
  );
  const columns: Column<IncidentTimesRow>[] = [
    { key: 'organization', header: 'Organization', cell: pick },
    { key: 'incidents', header: 'Incidents', cell: (row) => row.incidents, align: 'end' },
    {
      key: 'ackMedian',
      header: 'Acknowledge median',
      cell: (row) => durationText(row.ackMedianSec),
      align: 'end',
    },
    {
      key: 'ackP95',
      header: 'Acknowledge P95',
      cell: (row) => durationText(row.ackP95Sec),
      align: 'end',
    },
    {
      key: 'resolveMedian',
      header: 'Resolve median',
      cell: (row) => durationText(row.resolveMedianSec),
      align: 'end',
    },
    {
      key: 'resolveP95',
      header: 'Resolve P95',
      cell: (row) => durationText(row.resolveP95Sec),
      align: 'end',
    },
  ];
  return (
    <div className="flex flex-col gap-4">
      {selected && (
        <section aria-label={`Response times of ${name(selected)}`}>
          <p className="mb-2 text-body-sm text-ink-muted">
            {name(selected)}, {number(selected.incidents)}{' '}
            {selected.incidents === 1 ? 'incident' : 'incidents'}
          </p>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label="Acknowledge median" value={durationText(selected.ackMedianSec)} />
            <StatCard label="Acknowledge P95" value={durationText(selected.ackP95Sec)} />
            <StatCard label="Resolve median" value={durationText(selected.resolveMedianSec)} />
            <StatCard label="Resolve P95" value={durationText(selected.resolveP95Sec)} />
          </div>
        </section>
      )}
      <ReportTable
        caption="Incident times by organization"
        columns={columns}
        rows={rows}
        rowId={name}
        card={(row) => (
          <Pairs
            title={pick(row)}
            pairs={[
              ['Incidents', row.incidents],
              ['Acknowledge median', durationText(row.ackMedianSec)],
              ['Acknowledge P95', durationText(row.ackP95Sec)],
              ['Resolve median', durationText(row.resolveMedianSec)],
              ['Resolve P95', durationText(row.resolveP95Sec)],
            ]}
          />
        )}
      />
    </div>
  );
};

// The phone card of a row: a title, then label and value pairs.
const Pairs: React.FC<{ title: React.ReactNode; pairs: [string, React.ReactNode][] }> = ({
  title,
  pairs,
}) => (
  <div className="flex flex-col gap-1.5 text-body">
    <span className="font-semibold">{title}</span>
    <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-body-sm">
      {pairs.map(([label, value]) => (
        <React.Fragment key={label}>
          <dt className="text-ink-muted">{label}</dt>
          <dd className="m-0 text-right text-ink">{value}</dd>
        </React.Fragment>
      ))}
    </dl>
  </div>
);

// One report table on CollectionView (chapter 06 §9, D-096): the first column titles each row, the others
// are its fields, and the row's summary card is its details pane. A report is read only: no item actions.
function ReportTable<Row>({
  caption,
  columns,
  rows,
  rowId,
  rowName,
  card,
}: {
  caption: string;
  columns: Column<Row>[];
  rows: Row[];
  rowId: (row: Row) => string;
  /** The text that names one row; the row id by default (a variant or organization name). */
  rowName?: (row: Row) => string;
  card: (row: Row) => React.ReactNode;
}) {
  const [title, ...rest] = columns;
  const fields: CollectionField<Row>[] = rest.map((column) => ({
    key: column.key,
    label: typeof column.header === 'string' ? column.header : column.key,
    render: (row: Row) => column.cell(row),
    align: column.align,
    compact: true,
  }));
  return (
    <CollectionView<Row>
      label={caption}
      items={rows}
      itemId={rowId}
      itemName={rowName ?? rowId}
      itemTitle={(row) => <span className="font-normal text-ink">{title.cell(row)}</span>}
      fields={fields}
      noun={{ one: 'row', other: 'rows' }}
      details={{ fields: [], extra: card }}
      emptyState={{ title: 'No results match your filters.', description: 'Try a longer range.' }}
    />
  );
}

const Panel: React.FC<{ kind: ReportKind; rows: unknown[] }> = ({ kind, rows }) => {
  switch (kind) {
    case 'utilization':
      return <UtilizationPanel rows={rows as UtilizationRow[]} />;
    case 'revenue':
      return <RevenuePanel rows={rows as RevenueRow[]} />;
    case 'overdue':
      return <OverduePanel rows={rows as OverdueRow[]} />;
    case 'lost':
      return <LostPanel rows={rows as LostRow[]} />;
    case 'incident-times':
      return <IncidentTimesPanel rows={rows as IncidentTimesRow[]} />;
  }
};

// `/t/reports`, screen 9.4 (monitoring api-design 08, UC-59, FR-BILL-10): five reports over a period, each as
// a table with its chart where there is one, and the server's CSV file. TrekLink Staff and Admin. The tab,
// the period and so the view live in the URL (`?kind=&from=&to=`, `to` exclusive as the API takes it).
export const ReportsPage: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [initial] = useState<Period>(() => monthPeriod(new Date()));
  const kindParam = params.get('kind');
  const kind: ReportKind = isReportKind(kindParam) ? kindParam : 'utilization';
  const fromParam = params.get('from');
  const toParam = params.get('to');
  const period: Period =
    isDay(fromParam) && isDay(toParam) ? { from: fromParam, to: toParam } : initial;

  const [fromInput, setFromInput] = useState(period.from);
  const [toInput, setToInput] = useState(addDays(period.to, -1));
  const [periodMessage, setPeriodMessage] = useState<string | null>(null);
  const [downloaded, setDownloaded] = useState(false);
  const [csvFailure, setCsvFailure] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstKind = useRef(kind);

  const report = useReport(kind, period.from, period.to);

  // Browser back and forward change the period in the URL; the fields follow it.
  const periodKey = `${period.from}/${period.to}`;
  const [shownPeriod, setShownPeriod] = useState(periodKey);
  if (shownPeriod !== periodKey) {
    setShownPeriod(periodKey);
    setFromInput(period.from);
    setToInput(addDays(period.to, -1));
    setPeriodMessage(null);
  }

  // A tab switch moves focus to the table heading (screen 9.4); the first render leaves it alone.
  useEffect(() => {
    if (firstKind.current !== kind) headingRef.current?.focus();
  }, [kind]);

  useEffect(() => {
    if (!downloaded) return;
    const timer = setTimeout(() => setDownloaded(false), DOWNLOADED_MS);
    return () => clearTimeout(timer);
  }, [downloaded]);

  const go = (next: { kind?: ReportKind; period?: Period }) => {
    const target = next.period ?? period;
    setCsvFailure(null);
    setParams(new URLSearchParams({ kind: next.kind ?? kind, from: target.from, to: target.to }));
  };

  const apply = (chosen: Period | null, lastDay: string) => {
    const from = chosen?.from ?? fromInput;
    const message = periodError(from, lastDay);
    setPeriodMessage(message);
    if (message) return;
    go({ period: { from, to: addDays(lastDay, 1) } });
  };

  const quick = (chosen: Period) => {
    setFromInput(chosen.from);
    setToInput(addDays(chosen.to, -1));
    apply(chosen, addDays(chosen.to, -1));
  };

  const download = async () => {
    setDownloading(true);
    setCsvFailure(null);
    try {
      const csv = await fetchReportCsv(kind, period.from, period.to);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = csvName(kind, period.from, period.to);
      link.click();
      URL.revokeObjectURL(url);
      setDownloaded(true);
    } catch (error) {
      setCsvFailure(messageOf(error));
    } finally {
      setDownloading(false);
    }
  };

  const failure = report.error;
  const forbidden =
    failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404);
  const rows = useMemo(() => (report.data?.rows ?? []) as unknown[], [report.data]);
  if (forbidden) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const rangeText = `${formatDay(period.from)} to ${formatDay(addDays(period.to, -1))}`;

  return (
    <section aria-labelledby="reports-title" data-fit-page="" className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader
        id="reports-title"
        title="Reports"
        description={rangeText}
        primaryAction={
          <Button
            variant="secondary"
            loading={downloading}
            loadingLabel="Preparing"
            onClick={() => void download()}
          >
            {downloaded ? 'Downloaded' : 'Download CSV'}
          </Button>
        }
      />
      <PageScrollBody label="Report results" className="flex flex-col gap-4">
        {csvFailure && (
          <Alert
            tone="error"
            action={
              <Button variant="secondary" size="sm" onClick={() => void download()}>
                Retry
              </Button>
            }
          >
            {csvFailure}
          </Alert>
        )}

        <Card aria-labelledby="reports-period">
          <CardHeader title="Period" id="reports-period" />
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              apply(null, toInput);
            }}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="reports-from" label="From" required>
                <Input
                  id="reports-from"
                  type="date"
                  value={fromInput}
                  onChange={(event) => setFromInput(event.target.value)}
                />
              </Field>
              <Field id="reports-to" label="To" required error={periodMessage ?? undefined}>
                <Input
                  id="reports-to"
                  type="date"
                  value={toInput}
                  onChange={(event) => setToInput(event.target.value)}
                  {...invalid('reports-to', periodMessage ?? undefined)}
                />
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary">
                Apply
              </Button>
              <Button type="button" variant="ghost" onClick={() => quick(monthPeriod(new Date()))}>
                This month
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => quick(monthPeriod(new Date(), -1))}
              >
                Last month
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => quick(lastDaysPeriod(new Date(), 30))}
              >
                Last 30 days
              </Button>
            </div>
          </form>
        </Card>

        <div className="sm:hidden">
          <label htmlFor="reports-kind" className="mb-1.5 block text-body-sm font-semibold text-ink">
            Report
          </label>
          <Select
            id="reports-kind"
            value={kind}
            onChange={(event) => go({ kind: event.target.value as ReportKind })}
          >
            {TAB_ITEMS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="hidden sm:block">
          <Tabs
            label="Reports"
            idPrefix="reports"
            items={TAB_ITEMS}
            value={kind}
            onChange={(next) => go({ kind: next })}
          />
        </div>

        <TabPanel idPrefix="reports" tabKey={kind} className="flex flex-col gap-4">
          <h2 ref={headingRef} tabIndex={-1} className="text-title-sm text-ink outline-none">
            {KIND_LABEL[kind]}
          </h2>

          {failure && !(failure instanceof ApiError && failure.statusCode === 400) && (
            <ErrorState error={failure} onRetry={() => void report.refetch()} />
          )}
          {failure instanceof ApiError && failure.statusCode === 400 && (
            <Alert tone="error">{messageOf(failure)}</Alert>
          )}

          {report.isPending && (
            <div role="status" aria-label="Loading the report" className="flex flex-col gap-2">
              {Array.from({ length: 5 }, (_, index) => (
                <Skeleton key={index} className="h-10 w-full" />
              ))}
            </div>
          )}

          {report.data && (
            <>
              <Panel kind={kind} rows={rows} />
              <p className="text-body-sm text-ink-muted">
                {rows.length} {rows.length === 1 ? 'row' : 'rows'}, generated{' '}
                {formatTime(report.dataUpdatedAt)}
              </p>
            </>
          )}
        </TabPanel>
      </PageScrollBody>
    </section>
  );
};
