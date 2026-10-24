// @vitest-environment jsdom
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMapConfig, type MapConfig } from '../../shared/config/map';
import { LiveMapWidget, type MapMarker } from './LiveMapWidget';

vi.mock('../../shared/config/map', async (original) => ({
  ...(await original<typeof import('../../shared/config/map')>()),
  getMapConfig: vi.fn(),
}));

const config: MapConfig = {
  provider: 'openstreetmap',
  tileUrl: 'https://tiles.example.test/{z}/{x}/{y}.png',
  attribution: '© Example contributors',
  defaultViewport: { lat: 11.56, lon: 108.54, zoom: 12 },
  sovereigntyOverlay: [
    { label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112.0 },
    { label: 'Quần đảo Trường Sa (Việt Nam)', lat: 10.0, lon: 114.0 },
  ],
  staleAfterSeconds: 300,
};

const client = new QueryClient();
const tree = (markers: MapMarker[]) => (
  <QueryClientProvider client={client}>
    <LiveMapWidget markers={markers} />
  </QueryClientProvider>
);
const renderWidget = (markers: MapMarker[] = []) => render(tree(markers));

// Leaflet only requests tiles for a container that has a size, and jsdom reports none.
const giveContainersASize = () => {
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 512 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 512 });
};
const tileImages = (container: HTMLElement) => Array.from(container.querySelectorAll('img.leaflet-tile'));

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
    expect(container.querySelector('.leaflet-control-attribution')?.textContent).toContain('Example contributors');
    expect(container.querySelector('.leaflet-sovereignty-pane')).toBeTruthy();
  });

  it('shows MSG33 when the config cannot be loaded (REQ-EVT-04)', async () => {
    vi.mocked(getMapConfig).mockRejectedValue(new Error('down'));
    renderWidget();
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toBe('The map is unavailable. Device and incident lists are still live.'),
    );
  });

  it('adds, moves and removes markers as the set changes, with a text alternative and a popup', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { rerender } = renderWidget([device('TL-0001', [11.5, 108.5]), device('TL-0002', [11.6, 108.6])]);
    await waitFor(() => expect(screen.getByRole('img', { name: 'TL-0001, Battery 80%' })).toBeTruthy());
    expect(screen.getByRole('img', { name: 'TL-0002, Battery 80%' })).toBeTruthy();

    rerender(tree([device('TL-0001', [11.7, 108.7])]));
    expect(screen.getByRole('img', { name: 'TL-0001, Battery 80%' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: 'TL-0002, Battery 80%' })).toBeNull();

    fireEvent.click(screen.getByRole('img', { name: 'TL-0001, Battery 80%' }).parentElement as HTMLElement);
    await waitFor(() => expect(document.querySelector('.leaflet-popup-content')?.textContent).toBe('TL-0001Battery 80%'));
  });

  it('shows MSG33 with the overlay labels listed when a whole batch of tiles fails (REQ-EVT-04)', async () => {
    giveContainersASize();
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget();
    await waitFor(() => expect(tileImages(container).length).toBeGreaterThan(0));
    act(() => tileImages(container).forEach((tile) => fireEvent.error(tile)));
    const panel = await screen.findByRole('alert');
    expect(panel.textContent).toContain('The map is unavailable. Device and incident lists are still live.');
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
});
