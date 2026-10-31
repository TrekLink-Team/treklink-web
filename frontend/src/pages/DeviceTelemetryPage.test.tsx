// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { History, HistoryPoint, HistoryRange } from '../entities/telemetry-history/api';
import { ApiError } from '../shared/api/apiClient';
import { useToast } from '../shared/ui';
import type { MapMarker } from '../widgets/LiveMapWidget/LiveMapWidget';
import { DeviceTelemetryPage } from './DeviceTelemetryPage';

const fetchHistoryCsv = vi.fn();
let state: { data?: History; isPending: boolean; error: unknown } = { isPending: true, error: null };
const refetch = vi.fn();
const ranges: HistoryRange[] = [];
let mapProps: { markers?: MapMarker[]; track?: [number, number][]; selectedId?: string | null } = {};

vi.mock('../entities/telemetry-history/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../entities/telemetry-history/api')>()),
  useHistory: (_id: string, range: HistoryRange) => {
    ranges.push(range);
    return { ...state, refetch };
  },
  fetchHistoryCsv: (...args: unknown[]) => fetchHistoryCsv(...args),
}));

vi.mock('../widgets/LiveMapWidget/LiveMapWidget', () => ({
  LiveMapWidget: (props: typeof mapProps) => {
    mapProps = props;
    return <div data-testid="map" />;
  },
}));

const point = (minute: number, overrides: Partial<HistoryPoint> = {}): HistoryPoint => ({
  at: new Date(Date.UTC(2026, 9, 20, 3, minute)).toISOString(),
  kind: 'POSITION',
  lat: 11.56 + minute / 1000,
  lon: 108.54,
  altitude: 1320,
  batteryPct: 81 - minute,
  ...overrides,
});

const history = (overrides: Partial<History> = {}): History => ({
  deviceId: 'd-1',
  clippedTo: [{ from: '2026-10-20T02:00:00.000Z', to: '2026-10-21T00:00:00.000Z' }],
  points: [point(0), point(1, { kind: 'TELEMETRY', lat: null, lon: null }), point(2)],
  truncated: false,
  ...overrides,
});

const Probe: React.FC = () => <p data-testid="search">{useLocation().search}</p>;

const renderPage = (scope: 'o' | 't' = 'o', search = '') =>
  render(
    <MemoryRouter
      initialEntries={[
        { pathname: `/${scope}/devices/d-1/telemetry`, search, state: { assetTag: 'TL-0042' } },
      ]}
    >
      <Routes>
        <Route
          path="/:scope/devices/:id/telemetry"
          element={
            <>
              <DeviceTelemetryPage scope={scope} />
              <Probe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );

beforeEach(() => {
  state = { data: history(), isPending: false, error: null };
});

afterEach(() => {
  cleanup();
  ranges.length = 0;
  mapProps = {};
  fetchHistoryCsv.mockReset();
  refetch.mockReset();
  useToast.setState({ message: null });
  vi.restoreAllMocks();
});

describe('DeviceTelemetryPage (screen 9.2)', () => {
  it('defaults to the last 24 hours and shows the points, the track and the rental period', () => {
    renderPage();
    expect(screen.getByText('Device TL-0042')).toBeTruthy();
    const range = ranges[0];
    expect(Date.parse(range.to) - Date.parse(range.from)).toBe(86_400_000);
    expect(range.kinds).toEqual(['POSITION', 'TELEMETRY']);
    expect(screen.getByText(/3 points/)).toBeTruthy();
    expect(screen.getByText(/Your rental periods in this range:/)).toBeTruthy();
    expect(mapProps.track).toHaveLength(2);
    expect(mapProps.markers?.map((marker) => marker.id)).toEqual(['start', 'end']);
    expect(screen.getByRole('group', { name: /^Track of TL-0042 .* 2 positions$/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Battery of TL-0042/ })).toBeTruthy();
    expect(screen.getByRole('table', { name: 'Positions and telemetry' })).toBeTruthy();
  });

  it('shows no rental period to Staff, who read the whole history', () => {
    state = { data: history({ clippedTo: [] }), isPending: false, error: null };
    renderPage('t');
    expect(screen.queryByText(/Your rental periods/)).toBeNull();
  });

  it('reads the range and the kind from the URL', () => {
    renderPage('o', '?from=2026-10-20T00:00:00.000Z&to=2026-10-21T00:00:00.000Z&kind=TELEMETRY');
    expect(ranges[0]).toEqual({
      from: '2026-10-20T00:00:00.000Z',
      to: '2026-10-21T00:00:00.000Z',
      kinds: ['TELEMETRY'],
    });
    expect((screen.getByLabelText('Positions') as HTMLInputElement).checked).toBe(false);
    expect((screen.getByLabelText('Telemetry') as HTMLInputElement).checked).toBe(true);
  });

  it('writes an applied period to the URL', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-10-20T08:00' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-21T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('from='));
    const last = ranges[ranges.length - 1];
    expect(Date.parse(last.to) - Date.parse(last.from)).toBe(86_400_000);
    expect(screen.getByTestId('search').textContent).not.toContain('kind=');
  });

  it('blocks a reversed or too long period with MSG35 and sends nothing', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(/^From/), { target: { value: '2026-10-21T08:00' } });
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-20T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Choose an end after the start, at most 7 days later.')).toBeTruthy();
    expect(screen.getByTestId('search').textContent).toBe('');
    fireEvent.change(screen.getByLabelText(/^To/), { target: { value: '2026-10-30T08:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByText('Choose an end after the start, at most 7 days later.')).toBeTruthy();
    expect(screen.getByTestId('search').textContent).toBe('');
  });

  it('applies the Last 7 days button at once', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Last 7 days' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('from='));
    const last = ranges[ranges.length - 1];
    expect(Date.parse(last.to) - Date.parse(last.from)).toBe(7 * 86_400_000);
  });

  it('keeps at least one kind ticked and sends the other kind as the filter', async () => {
    renderPage();
    fireEvent.click(screen.getByLabelText('Positions'));
    fireEvent.click(screen.getByLabelText('Telemetry'));
    expect((screen.getByLabelText('Telemetry') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(screen.getByTestId('search').textContent).toContain('kind=TELEMETRY'));
  });

  it('gives every clicked row its own marker id, so the map pans on each click', () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('row')[1]);
    expect(mapProps.selectedId).toBe('selected-0');
    expect(mapProps.markers?.some((marker) => marker.id === 'selected-0')).toBe(true);
    fireEvent.click(screen.getAllByRole('row')[3]);
    expect(mapProps.selectedId).toBe('selected-2');
    expect(mapProps.markers?.some((marker) => marker.id === 'selected-2')).toBe(true);
    expect(mapProps.markers?.some((marker) => marker.id === 'selected-0')).toBe(false);
  });

  describe('Back', () => {
    const renderFrom = (entries: string[], initialIndex: number) =>
      render(
        <MemoryRouter initialEntries={entries} initialIndex={initialIndex}>
          <Routes>
            <Route
              path="/o/devices/:id/telemetry"
              element={<DeviceTelemetryPage scope="o" />}
            />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>,
      );
    const PathProbe: React.FC = () => <p data-testid="path">{useLocation().pathname}</p>;

    it('goes to the map when the page is the first entry, for example a typed URL', () => {
      renderFrom(['/o/devices/d-1/telemetry'], 0);
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByTestId('path').textContent).toBe('/o/map');
    });

    it('goes to the page that opened it otherwise', () => {
      renderFrom(['/o/contracts/c-1', '/o/devices/d-1/telemetry'], 1);
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByTestId('path').textContent).toBe('/o/contracts/c-1');
    });

    it('goes to the Staff map for Staff', () => {
      render(
        <MemoryRouter initialEntries={['/t/devices/d-1/telemetry']}>
          <Routes>
            <Route path="/t/devices/:id/telemetry" element={<DeviceTelemetryPage scope="t" />} />
            <Route path="*" element={<PathProbe />} />
          </Routes>
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Back' }));
      expect(screen.getByTestId('path').textContent).toBe('/t/map');
    });
  });

  it('pages the table by 50 rows', () => {
    state = {
      data: history({ points: Array.from({ length: 120 }, (_, index) => point(index % 60)) }),
      isPending: false,
      error: null,
    };
    renderPage();
    expect(screen.getAllByRole('row')).toHaveLength(51);
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(screen.getByText(/51 to 100 of 120/)).toBeTruthy();
  });

  it('says so, with the rental period, when the range holds no point', () => {
    state = { data: history({ points: [] }), isPending: false, error: null };
    renderPage();
    expect(screen.getByText('No results match your filters.')).toBeTruthy();
    expect(screen.getByText(/Your organization rented this device from/)).toBeTruthy();
  });

  it('warns that a capped range is incomplete', () => {
    state = { data: history({ truncated: true }), isPending: false, error: null };
    renderPage();
    expect(screen.getByText(/only the first 50,000 are shown/)).toBeTruthy();
  });

  it('shows skeletons while loading', () => {
    state = { isPending: true, error: null };
    renderPage();
    expect(screen.getByRole('status', { name: 'Loading history' })).toBeTruthy();
  });

  it('shows MSG26 alone for a refused or foreign device, and nothing else', () => {
    state = { isPending: false, error: new ApiError(404, 'NOT_FOUND', 'Device not found.') };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe('You do not have access to this.');
    expect(screen.queryByRole('button', { name: 'Apply' })).toBeNull();
  });

  it('shows the server message for a bad range and Retry for a server error', () => {
    state = {
      isPending: false,
      error: new ApiError(400, 'VALIDATION_FAILED', 'to must be after from and at most 7 days later.'),
    };
    renderPage();
    expect(screen.getByText('to must be after from and at most 7 days later.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
    cleanup();
    state = { isPending: false, error: new ApiError(500, 'INTERNAL_ERROR', 'Something broke.') };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalled();
  });

  describe('Download CSV', () => {
    beforeEach(() => {
      URL.createObjectURL = vi.fn(() => 'blob:history');
      URL.revokeObjectURL = vi.fn();
    });

    it('saves the CSV text of the applied range under a name with the tag and the days', async () => {
      fetchHistoryCsv.mockResolvedValue('at,kind\n# truncated');
      let saved = '';
      vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
        this: HTMLAnchorElement,
      ) {
        saved = this.download;
      });
      renderPage('o', '?from=2026-10-20T00:00:00.000Z&to=2026-10-21T00:00:00.000Z');
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
      await waitFor(() => expect(saved).toBe('telemetry-TL-0042-2026-10-20-2026-10-21.csv'));
      expect(fetchHistoryCsv).toHaveBeenCalledWith('d-1', expect.objectContaining({
        from: '2026-10-20T00:00:00.000Z',
      }));
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:history');
    });

    it('tells the user when the download fails', async () => {
      fetchHistoryCsv.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'Export failed.'));
      renderPage();
      fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
      await waitFor(() => expect(useToast.getState().message).toBe('Export failed.'));
    });
  });
});
