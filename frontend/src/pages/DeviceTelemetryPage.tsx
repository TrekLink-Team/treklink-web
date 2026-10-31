import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  HISTORY_KINDS,
  HISTORY_MAX_DAYS,
  fetchHistoryCsv,
  periodError,
  useHistory,
  type HistoryKind,
  type HistoryPoint,
  type HistoryRange,
} from '../entities/telemetry-history/api';
import { ApiError } from '../shared/api/apiClient';
import { formatDateTime } from '../shared/lib/format';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  DataTable,
  Field,
  Input,
  PageHeader,
  Pagination,
  Skeleton,
  useToast,
  type Column,
} from '../shared/ui';
import { invalid, messageOf } from '../shared/ui/errors';
import { BatteryChart } from '../widgets/BatteryChart/BatteryChart';
import { LiveMapWidget, type MapMarker } from '../widgets/LiveMapWidget/LiveMapWidget';

const PAGE_SIZE = 50;
const DAY_MS = 86_400_000;

interface Row extends HistoryPoint {
  key: string;
}

const pad = (value: number) => String(value).padStart(2, '0');

// The value a `datetime-local` input holds: the viewer's local time without a zone.
const toLocalInput = (iso: string): string => {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// The instant a `datetime-local` value means, as ISO 8601 UTC, or null when it is empty or invalid.
const fromLocalInput = (value: string): string | null => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const lastDays = (days: number, kinds: readonly HistoryKind[] = HISTORY_KINDS): HistoryRange => {
  const to = new Date();
  to.setSeconds(0, 0);
  return {
    from: new Date(to.getTime() - days * DAY_MS).toISOString(),
    to: to.toISOString(),
    kinds,
  };
};

// The range in the URL (`?from=&to=`, ISO dates, and `kind` for one kind), or null when it has none.
const rangeOf = (params: URLSearchParams): HistoryRange | null => {
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || Number.isNaN(Date.parse(from)) || Number.isNaN(Date.parse(to))) return null;
  const kind = params.get('kind');
  const one = HISTORY_KINDS.find((candidate) => candidate === kind);
  return { from, to, kinds: one ? [one] : HISTORY_KINDS };
};

const withSeconds = (iso: string): string =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

const coordinate = (value: number | null): string => (value === null ? '–' : value.toFixed(5));

const COLUMNS: Column<Row>[] = [
  { key: 'at', header: 'Time', cell: (row) => withSeconds(row.at) },
  { key: 'kind', header: 'Kind', cell: (row) => <Badge>{row.kind}</Badge> },
  { key: 'lat', header: 'Latitude', cell: (row) => coordinate(row.lat), align: 'end' },
  { key: 'lon', header: 'Longitude', cell: (row) => coordinate(row.lon), align: 'end' },
  {
    key: 'altitude',
    header: 'Altitude (m)',
    cell: (row) => (row.altitude === null ? '–' : Math.round(row.altitude)),
    align: 'end',
    hideOnMobile: true,
  },
  {
    key: 'battery',
    header: 'Battery (%)',
    cell: (row) => (row.batteryPct === null ? '–' : row.batteryPct),
    align: 'end',
  },
];

const csvName = (tag: string, range: HistoryRange) =>
  `telemetry-${tag}-${range.from.slice(0, 10)}-${range.to.slice(0, 10)}.csv`;

// `/o/devices/:id/telemetry` and `/t/devices/:id/telemetry`, screen 9.2 (monitoring api-design 03, UC-40,
// FR-MON-07): where a device was and how its battery went over a range of at most seven days. An
// organization sees only the events attributed to it; Staff and Admin see the whole history. Read-only.
export const DeviceTelemetryPage: React.FC<{ scope: 'o' | 't' }> = ({ scope }) => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast((state) => state.show);
  const [params, setParams] = useSearchParams();
  const [fallback] = useState(() => lastDays(1));
  const applied = rangeOf(params) ?? fallback;
  const tag = (location.state as { assetTag?: string } | null)?.assetTag ?? id.slice(0, 8);

  const [fromInput, setFromInput] = useState(() => toLocalInput(applied.from));
  const [toInput, setToInput] = useState(() => toLocalInput(applied.to));
  const [kinds, setKinds] = useState<readonly HistoryKind[]>(applied.kinds);
  const [periodMessage, setPeriodMessage] = useState<string | null>(null);
  const [pageNumber, setPageNumber] = useState(1);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const summary = useRef<HTMLParagraphElement>(null);
  const focusSummary = useRef(false);

  const history = useHistory(id, applied);

  // After Apply, focus moves to the result summary once the new points have arrived.
  useEffect(() => {
    if (focusSummary.current && history.data) {
      summary.current?.focus();
      focusSummary.current = false;
    }
  }, [history.data]);

  const rows = useMemo<Row[]>(
    () => (history.data?.points ?? []).map((point, index) => ({ ...point, key: String(index) })),
    [history.data],
  );
  const positions = useMemo(
    () => rows.filter((row) => row.kind === 'POSITION' && row.lat !== null && row.lon !== null),
    [rows],
  );
  const track = useMemo<[number, number][]>(
    () => positions.map((row) => [row.lat as number, row.lon as number]),
    [positions],
  );
  const readings = useMemo(
    () =>
      rows.flatMap((row) => (row.batteryPct === null ? [] : [{ at: row.at, batteryPct: row.batteryPct }])),
    [rows],
  );
  const markers = useMemo<MapMarker[]>(() => {
    const list: MapMarker[] = [];
    const first = positions[0];
    const last = positions[positions.length - 1];
    if (first) {
      list.push({
        id: 'start',
        position: [first.lat as number, first.lon as number],
        title: 'Start',
        subtitle: formatDateTime(first.at),
        status: 'ok',
      });
    }
    if (last && last !== first) {
      list.push({
        id: 'end',
        position: [last.lat as number, last.lon as number],
        title: 'End',
        subtitle: formatDateTime(last.at),
        status: 'ok',
      });
    }
    const chosen = rows.find((row) => row.key === selectedKey);
    if (chosen && chosen.lat !== null && chosen.lon !== null) {
      list.push({
        id: 'selected',
        position: [chosen.lat, chosen.lon],
        title: formatDateTime(chosen.at),
        subtitle: chosen.kind,
        status: 'warning',
      });
    }
    return list;
  }, [positions, rows, selectedKey]);

  const apply = (from: string | null, to: string | null, chosen: readonly HistoryKind[]) => {
    const message = from && to ? periodError(from, to) : periodError('', '');
    setPeriodMessage(message);
    if (message || !from || !to) return;
    const next = new URLSearchParams({ from, to });
    if (chosen.length === 1) next.set('kind', chosen[0]);
    focusSummary.current = true;
    setPageNumber(1);
    setSelectedKey(null);
    setParams(next);
  };

  const quick = (days: number) => {
    const range = lastDays(days, kinds);
    setFromInput(toLocalInput(range.from));
    setToInput(toLocalInput(range.to));
    apply(range.from, range.to, kinds);
  };

  const toggleKind = (kind: HistoryKind, on: boolean) => {
    const next = on ? [...kinds, kind] : kinds.filter((candidate) => candidate !== kind);
    // At least one kind stays ticked (screen 9.2, form rule).
    if (next.length > 0) setKinds(HISTORY_KINDS.filter((candidate) => next.includes(candidate)));
  };

  const download = async () => {
    setDownloading(true);
    try {
      const csv = await fetchHistoryCsv(id, applied);
      const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
      const link = document.createElement('a');
      link.href = url;
      link.download = csvName(tag, applied);
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      showToast(messageOf(error));
    } finally {
      setDownloading(false);
    }
  };

  const failure = history.error;
  // Another organization's device, an unknown id and a refused role read the same (MSG26, REQ-ERR-01).
  if (failure instanceof ApiError && (failure.statusCode === 403 || failure.statusCode === 404)) {
    return (
      <div role="alert" className="flex justify-center py-16">
        <p className="text-lg font-semibold text-ink">{messageOf(failure)}</p>
      </div>
    );
  }

  const data = history.data;
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((pageNumber - 1) * PAGE_SIZE, pageNumber * PAGE_SIZE);
  const rented = (data?.clippedTo ?? [])
    .map((period) => `${formatDateTime(period.from)} to ${period.to ? formatDateTime(period.to) : 'now'}`)
    .join('; ');
  const trackText =
    positions.length > 0
      ? `Track of ${tag} from ${formatDateTime(positions[0].at)} to ${formatDateTime(positions[positions.length - 1].at)}, ${positions.length} positions`
      : `No positions of ${tag} in this range`;

  return (
    <section aria-labelledby="telemetry-title" className="flex flex-col gap-4">
      <PageHeader
        id="telemetry-title"
        title="Telemetry history"
        description={`Device ${tag}`}
        actions={
          <>
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Back
            </Button>
            <Button
              variant="secondary"
              onClick={() => void download()}
              loading={downloading}
              loadingLabel="Preparing"
            >
              Download CSV
            </Button>
          </>
        }
      />

      <Card aria-labelledby="telemetry-range">
        <CardHeader title="Period" id="telemetry-range" />
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            apply(fromLocalInput(fromInput), fromLocalInput(toInput), kinds);
          }}
          className="flex flex-col gap-4"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="telemetry-from" label="From" required>
              <Input
                id="telemetry-from"
                type="datetime-local"
                value={fromInput}
                onChange={(event) => setFromInput(event.target.value)}
              />
            </Field>
            <Field id="telemetry-to" label="To" required error={periodMessage ?? undefined}>
              <Input
                id="telemetry-to"
                type="datetime-local"
                value={toInput}
                onChange={(event) => setToInput(event.target.value)}
                {...invalid('telemetry-to', periodMessage ?? undefined)}
              />
            </Field>
          </div>
          <fieldset className="flex flex-wrap gap-x-6">
            <legend className="text-body-sm font-semibold text-ink">Show</legend>
            <Checkbox
              label="Positions"
              checked={kinds.includes('POSITION')}
              onChange={(event) => toggleKind('POSITION', event.target.checked)}
            />
            <Checkbox
              label="Telemetry"
              checked={kinds.includes('TELEMETRY')}
              onChange={(event) => toggleKind('TELEMETRY', event.target.checked)}
            />
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary">
              Apply
            </Button>
            <Button type="button" variant="secondary" onClick={() => quick(1)}>
              Last 24 hours
            </Button>
            <Button type="button" variant="secondary" onClick={() => quick(HISTORY_MAX_DAYS)}>
              Last {HISTORY_MAX_DAYS} days
            </Button>
          </div>
        </form>
      </Card>

      {failure && (
        <Alert
          tone="error"
          action={
            failure instanceof ApiError && failure.statusCode === 400 ? undefined : (
              <Button variant="secondary" size="sm" onClick={() => void history.refetch()}>
                Retry
              </Button>
            )
          }
        >
          {messageOf(failure)}
        </Alert>
      )}

      {data?.truncated && (
        <Alert tone="warning">
          This range holds more than 50,000 points, so only the first 50,000 are shown. Choose a
          shorter range to see the rest.
        </Alert>
      )}

      {history.isPending && (
        <div role="status" aria-label="Loading history" className="flex flex-col gap-4">
          <Skeleton rounded="panel" className="h-60" />
          <Skeleton rounded="panel" className="h-40" />
        </div>
      )}

      {data && (
        <>
          <p ref={summary} tabIndex={-1} aria-live="polite" className="text-body text-ink outline-none">
            {data.points.length} {data.points.length === 1 ? 'point' : 'points'}
            {scope === 'o' && rented ? `. Your rental periods in this range: ${rented}` : ''}
          </p>
          <div role="group" aria-label={trackText}>
            <LiveMapWidget
              className="h-60 md:h-80"
              markers={markers}
              selectedId={selectedKey ? 'selected' : null}
              track={track}
            />
          </div>
          <Card aria-labelledby="telemetry-battery">
            <CardHeader title="Battery" id="telemetry-battery" />
            <BatteryChart readings={readings} deviceLabel={tag} />
          </Card>
          <DataTable
            caption="Positions and telemetry"
            columns={COLUMNS}
            rows={pageRows}
            rowId={(row) => row.key}
            empty={{
              title: 'No results match your filters.',
              description:
                scope === 'o' && rented
                  ? `Your organization rented this device from ${rented}.`
                  : 'Choose another period or show both kinds.',
            }}
            activeRowId={selectedKey ?? undefined}
            onRowActivate={(row) => setSelectedKey(row.key)}
            renderCard={(row) => (
              <div className="flex flex-col gap-1 text-body">
                <div className="flex items-center justify-between gap-2">
                  <span>{withSeconds(row.at)}</span>
                  <Badge>{row.kind}</Badge>
                </div>
                <span className="text-ink-muted">
                  {coordinate(row.lat)}, {coordinate(row.lon)}
                </span>
                <span className="text-ink-muted">
                  Battery {row.batteryPct === null ? '–' : `${row.batteryPct} %`}
                </span>
              </div>
            )}
            footer={
              rows.length > PAGE_SIZE ? (
                <Pagination
                  pageNumber={pageNumber}
                  totalPages={pages}
                  totalItems={rows.length}
                  pageSize={PAGE_SIZE}
                  onPage={setPageNumber}
                />
              ) : undefined
            }
          />
        </>
      )}
    </section>
  );
};
