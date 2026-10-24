// @vitest-environment jsdom
import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getMapConfig, type MapConfig } from '../../shared/config/map';
import { LiveMapWidget } from './LiveMapWidget';

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

const renderWidget = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <LiveMapWidget />
    </QueryClientProvider>,
  );

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
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
});
