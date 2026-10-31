// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapConfig, type MapConfig } from '../../shared/config/map';
import { LiveMapWidget, type MapMarker } from './LiveMapWidget';

vi.mock('../../shared/config/map', async (original) => ({
  ...(await original<typeof import('../../shared/config/map')>()),
  getMapConfig: vi.fn(),
}));

const topo = {
  id: 'example-topo',
  name: 'Example topo',
  tileUrl: 'https://tiles.example.test/{z}/{x}/{y}.png',
  attribution: '© Example contributors',
  maxZoom: 18,
  maxNativeZoom: 17,
};
const street = {
  id: 'example-street',
  name: 'Example street',
  tileUrl: 'https://street.example.test/{z}/{x}/{y}.png',
  attribution: '© Street contributors',
  maxZoom: 19,
  maxNativeZoom: 19,
};

const config: MapConfig = {
  provider: 'example-topo',
  tileUrl: topo.tileUrl,
  attribution: topo.attribution,
  basemaps: [street, topo],
  defaultViewport: { lat: 11.56, lon: 108.54, zoom: 12 },
  sovereigntyOverlay: [
    {
      label: 'Quần đảo Hoàng Sa (Việt Nam)',
      lat: 16.5,
      lon: 112.0,
      mask: [
        [17.7, 110.6],
        [17.7, 113.6],
        [15.2, 113.6],
        [15.2, 110.6],
      ],
    },
    {
      label: 'Quần đảo Trường Sa (Việt Nam)',
      lat: 10.0,
      lon: 114.0,
      mask: [
        [12.3, 111.1],
        [12.3, 117.7],
        [7.0, 115.2],
        [7.0, 111.1],
      ],
    },
  ],
  staleAfterSeconds: 300,
};

const client = new QueryClient();
const tree = (markers: MapMarker[], selectedId: string | null = null) => (
  <QueryClientProvider client={client}>
    <LiveMapWidget markers={markers} selectedId={selectedId} />
  </QueryClientProvider>
);
const renderWidget = (markers: MapMarker[] = []) => render(tree(markers));

// Leaflet only requests tiles for a container that has a size, and jsdom reports none.
const giveContainersASize = () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 512 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 512 });
};
const tileImages = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('img.leaflet-tile'));

const device = (id: string, position: [number, number]): MapMarker => ({
  id,
  position,
  title: id,
  subtitle: 'Battery 80%',
  status: 'ok',
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.resetAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('LiveMapWidget', () => {
  it('draws both overlay labels in their own pane and the configured attribution (AC-03)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(screen.getByText('Quần đảo Hoàng Sa (Việt Nam)')).toBeTruthy());
    expect(screen.getByText('Quần đảo Trường Sa (Việt Nam)')).toBeTruthy();
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain(
      'Example contributors',
    );
    expect(container.querySelector('.leaflet-sovereignty-pane')).toBeTruthy();
  });

  it('credits Leaflet by name only, with no flag icon in the attribution prefix', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(container.querySelector('.leaflet-control-attribution')).toBeTruthy());
    const attribution = container.querySelector('.leaflet-control-attribution') as HTMLElement;
    expect(attribution.querySelector('svg')).toBeNull();
    expect(attribution.querySelector('a[href="https://leafletjs.com"]')?.textContent).toBe('Leaflet');
  });

  it('draws an opaque mask under each label, below the label pane and the markers (D-085)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() =>
      expect(container.querySelectorAll('.leaflet-sovereignty-mask-pane path')).toHaveLength(2),
    );
    const pane = container.querySelector<HTMLElement>('.leaflet-sovereignty-mask-pane');
    expect(pane?.style.zIndex).toBe('450');
    for (const path of container.querySelectorAll('.leaflet-sovereignty-mask-pane path')) {
      expect(path.getAttribute('fill-opacity')).toBe('1');
    }
  });

  it('shows MSG33 when the config cannot be loaded (REQ-EVT-04)', async () => {
    vi.mocked(getMapConfig).mockRejectedValue(new Error('down'));
    renderWidget();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe(
        'The map is unavailable. Device and incident lists are still live.',
      ),
    );
  });

  it('adds, moves and removes markers as the set changes, with a text alternative and a popup', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { rerender } = renderWidget([
      device('TL-0001', [11.5, 108.5]),
      device('TL-0002', [11.6, 108.6]),
    ]);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'TL-0001, Battery 80%' })).toBeTruthy(),
    );
    expect(screen.getByRole('img', { name: 'TL-0002, Battery 80%' })).toBeTruthy();

    rerender(tree([device('TL-0001', [11.7, 108.7])]));
    expect(screen.getByRole('img', { name: 'TL-0001, Battery 80%' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'TL-0002, Battery 80%' })).toBeNull();

    fireEvent.click(
      screen.getByRole('img', { name: 'TL-0001, Battery 80%' }).parentElement as HTMLElement,
    );
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toBe(
        'TL-0001Battery 80%',
      ),
    );
  });

  it('draws a track through its points, and not for fewer than two (screen 9.2)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const withTrack = (track: [number, number][]) => (
      <QueryClientProvider client={client}>
        <LiveMapWidget track={track} />
      </QueryClientProvider>
    );
    const { container, rerender } = render(
      withTrack([
        [11.5, 108.5],
        [11.6, 108.6],
        [11.7, 108.5],
      ]),
    );
    await waitFor(() => expect(container.querySelector('.leaflet-overlay-pane path')).toBeTruthy());
    expect(container.querySelectorAll('.leaflet-overlay-pane path')).toHaveLength(1);
    rerender(withTrack([[11.5, 108.5]]));
    expect(container.querySelector('.leaflet-overlay-pane path')).toBeNull();
  });

  it('redraws a marker whose state changes and opens the popup of a selected marker', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { rerender } = renderWidget([device('TL-0001', [11.5, 108.5])]);
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'TL-0001, Battery 80%' })).toBeTruthy(),
    );
    const sos: MapMarker = {
      ...device('TL-0001', [11.5, 108.5]),
      subtitle: 'SOS, state Notifying primary',
      status: 'incident',
      details: ['Contract RC-2026-0001'],
    };
    rerender(tree([sos]));
    expect(screen.getByRole('img', { name: 'TL-0001, SOS, state Notifying primary' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'TL-0001, Battery 80%' })).toBeNull();

    rerender(tree([sos], 'missing'));
    expect(document.querySelector('.leaflet-popup-content')).toBeNull();
    rerender(tree([sos], 'TL-0001'));
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toBe(
        'TL-0001SOS, state Notifying primaryContract RC-2026-0001',
      ),
    );
  });

  it('opens the popup of each marker chosen in turn, not only the first (screen 9.2 row clicks)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const first = device('selected-0', [11.5, 108.5]);
    const second = device('selected-1', [11.6, 108.6]);
    const { rerender } = renderWidget([first]);
    await waitFor(() => expect(screen.getByRole('img', { name: /selected-0/ })).toBeTruthy());
    rerender(tree([first], 'selected-0'));
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toContain('selected-0'),
    );
    // The page swaps the one selected marker for the next row's, each with its own id.
    rerender(tree([second], 'selected-1'));
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toContain('selected-1'),
    );
  });

  it('shows MSG33 with the overlay labels listed when a whole batch of tiles fails (REQ-EVT-04)', async () => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(tileImages(container).length).toBeGreaterThan(0));
    act(() => tileImages(container).forEach((tile) => fireEvent.error(tile)));
    const panel = await screen.findByRole('alert');
    expect(panel.textContent).toContain(
      'The map is unavailable. Device and incident lists are still live.',
    );
    expect(panel.textContent).toContain('Quần đảo Trường Sa (Việt Nam)');
  });

  it('keeps the map when only some tiles fail, and recovers once a tile loads', async () => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(tileImages(container).length).toBeGreaterThan(1));
    const [first, ...rest] = tileImages(container);
    act(() => {
      fireEvent.error(first);
      rest.forEach((tile) => fireEvent.load(tile));
    });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('opens on the default basemap and offers every basemap, but not the overlay, in the layer control (D-072)', async () => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(tileImages(container).length).toBeGreaterThan(0));
    expect(
      tileImages(container).every((tile) =>
        tile.getAttribute('src')?.startsWith('https://tiles.example.test/'),
      ),
    ).toBe(true);
    const control = container.querySelector('.leaflet-control-layers') as HTMLElement;
    const names = Array.from(control.querySelectorAll('label')).map((label) =>
      label.textContent?.trim(),
    );
    expect(names).toEqual(['Example street', 'Example topo']);
    expect(control.textContent).not.toContain('Hoàng Sa');
    expect(control.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it('switches basemap and attribution, and keeps the overlay drawn (D-072, REQ-UBI-06)', async () => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(container.querySelector('.leaflet-control-layers')).toBeTruthy());
    const street = Array.from(container.querySelectorAll('.leaflet-control-layers label')).find(
      (label) => label.textContent?.includes('Example street'),
    ) as HTMLElement;
    act(() => fireEvent.click(street.querySelector('input') as HTMLInputElement));
    await waitFor(() =>
      expect(
        tileImages(container).some((tile) =>
          tile.getAttribute('src')?.startsWith('https://street.example.test/'),
        ),
      ).toBe(true),
    );
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain(
      'Street contributors',
    );
    expect(screen.getByText('Quần đảo Hoàng Sa (Việt Nam)')).toBeTruthy();
  });
});

describe('LiveMapWidget marker glide (dry run defect 10)', () => {
  // A frame queue the test advances by hand, with the timestamp each frame receives.
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 1;
  const runFrame = (now: number) => {
    const pending = [...frames.values()];
    frames.clear();
    act(() => pending.forEach((callback) => callback(now)));
  };
  const at: [number, number] = [11.56, 108.54];
  const near: [number, number] = [11.562, 108.542];
  const other: [number, number] = [11.558, 108.538];
  const lastMove = (spy: { mock: { calls: unknown[][] } }) =>
    L.latLng(spy.mock.calls.at(-1)?.[0] as L.LatLngExpression);
  const markerImg = () => screen.findByRole('img', { name: 'TL-0001, Battery 80%' });

  beforeEach(() => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(nextFrame, callback);
      return nextFrame++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  });

  afterEach(() => {
    frames.clear();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('places a new marker at once, then glides it to the next reading with its popup', async () => {
    const move = vi.spyOn(L.Marker.prototype, 'setLatLng');
    const popupMove = vi.spyOn(L.Popup.prototype, 'setLatLng');
    const { rerender } = render(tree([device('TL-0001', at)]));
    fireEvent.click((await markerImg()).parentElement as HTMLElement);
    await waitFor(() => expect(document.querySelector('.leaflet-popup-content')).toBeTruthy());
    expect(move).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);

    rerender(tree([device('TL-0001', near)]));
    expect(frames.size).toBe(1);
    runFrame(0);
    runFrame(500);
    const half = lastMove(move);
    expect(half.lat).toBeGreaterThan(at[0]);
    expect(half.lat).toBeLessThan(near[0]);
    runFrame(1000);
    expect(lastMove(move).equals(L.latLng(near))).toBe(true);
    expect(lastMove(popupMove).equals(L.latLng(near))).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('restarts from where the marker is when a reading arrives mid-glide', async () => {
    const move = vi.spyOn(L.Marker.prototype, 'setLatLng');
    const { rerender } = render(tree([device('TL-0001', at)]));
    await markerImg();
    rerender(tree([device('TL-0001', near)]));
    runFrame(0);
    runFrame(400);
    const mid = lastMove(move);
    rerender(tree([device('TL-0001', other)]));
    expect(frames.size).toBe(1);
    runFrame(450);
    expect(lastMove(move).equals(mid)).toBe(true);
    runFrame(1450);
    expect(lastMove(move).equals(L.latLng(other))).toBe(true);
  });

  it('pans a selected device to its latest reading, not to the marker mid-glide', async () => {
    const pan = vi.spyOn(L.Map.prototype, 'panTo');
    const { rerender } = render(tree([device('TL-0001', at)]));
    await markerImg();
    rerender(tree([device('TL-0001', near)]));
    runFrame(0);
    runFrame(300);
    rerender(tree([device('TL-0001', near)], 'TL-0001'));
    expect(L.latLng(pan.mock.calls.at(-1)?.[0] as L.LatLngExpression).equals(L.latLng(near))).toBe(
      true,
    );
  });

  it('jumps without a frame when the user prefers reduced motion', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const move = vi.spyOn(L.Marker.prototype, 'setLatLng');
    const { rerender } = render(tree([device('TL-0001', at)]));
    await markerImg();
    rerender(tree([device('TL-0001', near)]));
    expect(frames.size).toBe(0);
    expect(lastMove(move).equals(L.latLng(near))).toBe(true);
  });

  it('cancels a glide when its marker is removed and every glide on unmount', async () => {
    const { rerender, unmount } = render(tree([device('TL-0001', at), device('TL-0002', at)]));
    await markerImg();
    rerender(tree([device('TL-0001', near), device('TL-0002', other)]));
    expect(frames.size).toBe(2);
    rerender(tree([device('TL-0001', near)]));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});
