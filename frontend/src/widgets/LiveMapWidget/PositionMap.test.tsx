// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getMapConfig, type MapConfig } from '../../shared/config/map';
import { formatCoordinates } from '../../shared/ui/map/coordinates';
import { PositionMap } from './PositionMap';

vi.mock('../../shared/config/map', async (original) => ({
  ...(await original<typeof import('../../shared/config/map')>()),
  getMapConfig: vi.fn(),
}));

const config: MapConfig = {
  provider: 'example-topo',
  tileUrl: 'https://tiles.example.test/{z}/{x}/{y}.png',
  attribution: '© Example contributors',
  basemaps: [],
  defaultViewport: { lat: 16, lon: 107, zoom: 6 },
  sovereigntyOverlay: [
    { label: 'Quần đảo Hoàng Sa (Việt Nam)', lat: 16.5, lon: 112.0, mask: [] },
    { label: 'Quần đảo Trường Sa (Việt Nam)', lat: 10.0, lon: 114.0, mask: [] },
  ],
  staleAfterSeconds: 300,
};

const renderMap = (element: React.ReactElement) =>
  render(<QueryClientProvider client={new QueryClient()}>{element}</QueryClientProvider>);

beforeEach(() => {
  vi.mocked(getMapConfig).mockResolvedValue(config);
});
afterEach(cleanup);

describe('PositionMap (screens 4.2 and 4.4)', () => {
  it('formats coordinates to five decimals', () => {
    expect(formatCoordinates({ lat: 11.5612345, lon: 108.5401 })).toBe('11.56123, 108.54010');
  });

  it('draws the position on the shared map with the overlay and puts the coordinates under it', async () => {
    const { container } = renderMap(
      <PositionMap position={{ lat: 11.56, lon: 108.54 }} label="TL-0042" seenAt={new Date().toISOString()} />,
    );
    expect(screen.getByText('11.56000, 108.54000').tagName).toBe('FIGCAPTION');
    // The sovereignty overlay of D-031 is drawn on the small map as on every map.
    await waitFor(() => expect(container.textContent).toContain('Quần đảo Hoàng Sa (Việt Nam)'));
    expect(container.textContent).toContain('Quần đảo Trường Sa (Việt Nam)');
    const marker = container.querySelector('.leaflet-marker-icon[title^="TL-0042"]');
    expect(marker?.getAttribute('title')).toBe('TL-0042, last position, 11.56000, 108.54000');
  });

  it('marks a position older than the stale time as the last known one', async () => {
    const { container } = renderMap(
      <PositionMap position={{ lat: 11.56, lon: 108.54 }} label="TL-0042" seenAt="2026-01-01T00:00:00Z" />,
    );
    await waitFor(() =>
      expect(container.querySelector('.leaflet-marker-icon[title^="TL-0042"]')?.getAttribute('title')).toBe(
        'TL-0042, last known position, 11.56000, 108.54000',
      ),
    );
  });

  it('shows text in place of the map when there is no position', () => {
    const { container } = renderMap(<PositionMap position={null} label="TL-0042" />);
    expect(screen.getByText('Position unavailable')).toBeTruthy();
    expect(container.querySelector('.leaflet-container')).toBeNull();
  });
});
