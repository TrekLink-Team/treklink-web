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
    await waitFor(() =>
      expect(container.querySelector('.leaflet-control-attribution')).toBeTruthy(),
    );
    const attribution = container.querySelector('.leaflet-control-attribution') as HTMLElement;
    expect(attribution.querySelector('svg')).toBeNull();
    expect(attribution.querySelector('a[href="https://leafletjs.com"]')?.textContent).toBe(
      'Leaflet',
    );
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

  it('puts a marker link in its popup and hands a plain click to onLink (screen 9.1)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const onLink = vi.fn();
    const link = {
      label: 'Position history',
      to: '/o/devices/TL-0001/telemetry',
      state: { assetTag: 'TL-0001' },
    };
    render(
      <QueryClientProvider client={client}>
        <LiveMapWidget
          markers={[{ ...device('TL-0001', [11.5, 108.5]), links: [link] }]}
          onLink={onLink}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      (await screen.findByRole('img', { name: 'TL-0001, Battery 80%' }))
        .parentElement as HTMLElement,
    );
    const anchor = await screen.findByRole('link', { name: 'Position history' });
    expect(anchor.getAttribute('href')).toBe('/o/devices/TL-0001/telemetry');
    expect(document.querySelector('.leaflet-popup-content')?.textContent).toBe(
      'TL-0001Battery 80%Position history',
    );

    expect(fireEvent.click(anchor)).toBe(false);
    expect(onLink).toHaveBeenCalledWith(link);

    // A modified click is the browser's, so the link can open in a new tab.
    const prevented = vi.fn();
    const stop = (event: MouseEvent) => {
      prevented(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', stop);
    try {
      fireEvent.click(anchor, { ctrlKey: true });
      expect(prevented).toHaveBeenCalledWith(false);
      expect(onLink).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('click', stop);
    }
  });

  // Screen 9.1 on a phone: a marker alone at its spot reports its tap and opens no popup, because the page
  // shows the device as a card; a tap on the bare map puts the card away.
  it('reports the tap of a lone marker instead of opening a popup in card mode', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LiveMapWidget
          markers={[
            {
              ...device('TL-0001', [11.5, 108.5]),
              links: [{ label: 'Position history', to: '/o/devices/x/telemetry' }],
            },
          ]}
          cardMode
          onSelect={onSelect}
        />
      </QueryClientProvider>,
    );
    fireEvent.click(
      (await screen.findByRole('img', { name: 'TL-0001, Battery 80%' })).parentElement as HTMLElement,
    );
    expect(onSelect).toHaveBeenCalledWith('TL-0001');
    expect(document.querySelector('.leaflet-popup-content')).toBeNull();
  });

  it('keeps the popup list of a stack in card mode, and reports no tap for it', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LiveMapWidget
          markers={[device('TL-0001', [11.5, 108.5]), device('TL-0002', [11.5, 108.5])]}
          view={{ center: [11.5, 108.5], zoom: 16 }}
          cardMode
          onSelect={onSelect}
        />
      </QueryClientProvider>,
    );
    const first = await screen.findAllByRole('img', { name: /TL-000[12], .*Battery 80%/ });
    fireEvent.click(first[0].parentElement as HTMLElement);
    await waitFor(() =>
      expect(document.querySelector('.leaflet-popup-content')?.textContent).toContain(
        '2 devices at this spot',
      ),
    );
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('opens a popup for a lone marker when card mode is off', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const onSelect = vi.fn();
    render(
      <QueryClientProvider client={client}>
        <LiveMapWidget markers={[device('TL-0001', [11.5, 108.5])]} onSelect={onSelect} />
      </QueryClientProvider>,
    );
    fireEvent.click(
      (await screen.findByRole('img', { name: 'TL-0001, Battery 80%' })).parentElement as HTMLElement,
    );
    await waitFor(() => expect(document.querySelector('.leaflet-popup-content')).toBeTruthy());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('leaves a popup link to the browser when no onLink is given', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([
      {
        ...device('TL-0001', [11.5, 108.5]),
        links: [
          { label: 'Open incident INC-1', to: '/o/incidents/i-1' },
          { label: 'Position history', to: '/t/devices/x/telemetry' },
        ],
      },
    ]);
    fireEvent.click(
      (await screen.findByRole('img', { name: 'TL-0001, Battery 80%' }))
        .parentElement as HTMLElement,
    );
    // jsdom cannot follow a link, so the test notes whether the widget prevented it, then stops it.
    const prevented = vi.fn();
    const stop = (event: MouseEvent) => {
      prevented(event.defaultPrevented);
      event.preventDefault();
    };
    document.addEventListener('click', stop);
    try {
      // Both links show, in order, each with its own href.
      await screen.findByRole('link', { name: 'Position history' });
      const popup = document.querySelector('.leaflet-popup-content') as HTMLElement;
      expect([...popup.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'))).toEqual(
        ['/o/incidents/i-1', '/t/devices/x/telemetry'],
      );
      fireEvent.click(screen.getByRole('link', { name: 'Position history' }));
      expect(prevented).toHaveBeenCalledWith(false);
    } finally {
      document.removeEventListener('click', stop);
    }
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

  it('pans once per chosen id, and not again for a marker that moves under the same id (screen 9.2)', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const panTo = vi.spyOn(L.Map.prototype, 'panTo');
    try {
      const { rerender } = renderWidget([device('selected-0', [11.5, 108.5])]);
      await waitFor(() => expect(screen.getByRole('img', { name: /selected-0/ })).toBeTruthy());

      rerender(tree([device('selected-0', [11.5, 108.5])], 'selected-0'));
      await waitFor(() => expect(panTo).toHaveBeenCalledTimes(1));
      expect(panTo.mock.calls[0][0]).toEqual([11.5, 108.5]);

      // The page swaps the selected marker for the next row's, each with its own id: a second pan.
      rerender(tree([device('selected-1', [11.6, 108.6])], 'selected-1'));
      await waitFor(() => expect(panTo).toHaveBeenCalledTimes(2));
      expect(panTo.mock.calls[1][0]).toEqual([11.6, 108.6]);

      // The same id at a new position does not pan: why one shared id panned only on the first click.
      rerender(tree([device('selected-1', [11.7, 108.7])], 'selected-1'));
      await waitFor(() => expect(screen.getByRole('img', { name: /selected-1/ })).toBeTruthy());
      expect(panTo).toHaveBeenCalledTimes(2);
    } finally {
      panTo.mockRestore();
    }
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

  it('leaves OpenTopoMap and Stadia out of the picker and opens on the first offered basemap when the default is hidden (task W22)', async () => {
    giveContainersASize();
    const hiddenTopo = { ...topo, id: 'opentopomap', name: 'Topographic (OpenTopoMap)' };
    const hiddenTerrain = { ...topo, id: 'stadia-terrain', name: 'Terrain (Stadia)' };
    vi.mocked(getMapConfig).mockResolvedValue({
      ...config,
      provider: 'opentopomap',
      basemaps: [hiddenTopo, hiddenTerrain, street],
    });
    const { container } = renderWidget();
    await waitFor(() => expect(tileImages(container).length).toBeGreaterThan(0));
    expect(
      tileImages(container).every((tile) =>
        tile.getAttribute('src')?.startsWith('https://street.example.test/'),
      ),
    ).toBe(true);
    // One basemap left, so no layer control is drawn and nothing names the hidden ones.
    expect(container.querySelector('.leaflet-control-layers')).toBeNull();
    expect(container.textContent).not.toContain('OpenTopoMap');
    expect(container.textContent).not.toContain('Stadia');
    expect(screen.queryByRole('alert')).toBeNull();
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

  // The Leaflet map the widget builds, caught as L.map creates it.
  const catchMap = () => {
    const created = vi.spyOn(L, 'map');
    return () => created.mock.results.at(-1)?.value as L.Map;
  };
  // A reading `dx` px east of the default viewport's centre at its zoom.
  const east = (dx: number): [number, number] => {
    const { lat, lon, zoom } = config.defaultViewport;
    const crs = L.CRS.EPSG3857;
    const at = crs.pointToLatLng(crs.latLngToPoint(L.latLng(lat, lon), zoom).add([dx, 0]), zoom);
    return [at.lat, at.lng];
  };
  const nearPair = () => [device('TL-0009', east(0)), device('TL-0010', east(4))];
  const badgesOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('.leaflet-marker-pane .tl-cluster-hit'));
  const pinsOf = (container: HTMLElement) =>
    Array.from(container.querySelectorAll<HTMLElement>('.leaflet-marker-pane .tl-marker-hit'));
  const markersOf = (map: L.Map) => {
    const found: L.Marker[] = [];
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker && layer.getElement()?.classList.contains('tl-marker-hit'))
        found.push(layer);
    });
    return found;
  };
  const openPopup = (map: L.Map) => {
    let popup: L.Popup | undefined;
    map.eachLayer((layer) => {
      if (layer instanceof L.Popup && layer.isOpen()) popup = layer;
    });
    return popup;
  };

  // Leader ruling 2026-11-06: zoomed out, markers within 48 px draw as one badge at their centroid.
  it('draws two markers 4 px apart at zoom 12 as one cluster badge at their centroid', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const { container } = renderWidget([
      device('TL-0009', east(0)),
      { ...device('TL-0010', east(4)), status: 'stale' },
      device('TL-0011', east(200)),
    ]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    // The pair is off the map; the far unit draws on its own.
    expect(pinsOf(container)).toHaveLength(1);
    const badge = screen.getByRole('img', { name: /^2 devices, 1 offline, near / });
    expect(badge.textContent).toBe('2');
    expect(badge.classList.contains('tl-cluster--stale')).toBe(true);
    // At the true centroid of the readings, which never move.
    let centre: L.LatLng | undefined;
    mapOf().eachLayer((layer) => {
      if (layer instanceof L.Marker && layer.getElement()?.classList.contains('tl-cluster-hit'))
        centre = layer.getLatLng();
    });
    const [a, b] = [east(0), east(4)];
    expect(centre?.lat).toBeCloseTo((a[0] + b[0]) / 2, 9);
    expect(centre?.lng).toBeCloseTo((a[1] + b[1]) / 2, 9);
    // A 44 px target, at least the 24 px minimum of WCAG 2.5.8.
    const hit = badgesOf(container)[0];
    expect(hit.style.width).toBe('44px');
    expect(hit.style.height).toBe('44px');
    expect(hit.style.marginLeft).toBe('-22px');
  });

  it('colours a badge by the most severe state inside and names SOS first', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const { container } = renderWidget([
      { ...device('TL-0001', east(0)), status: 'unheard' },
      { ...device('TL-0002', east(10)), status: 'incident' },
      device('TL-0003', east(20)),
    ]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    const badge = screen.getByRole('img', {
      name: /^3 devices, 1 SOS, 1 not heard since handover, near -?\d+\.\d{4}, -?\d+\.\d{4}$/,
    });
    expect(badge.classList.contains('tl-cluster--sos')).toBe(true);
    expect(badge.querySelector('.tl-cluster-flag')?.textContent).toBe('SOS');
  });

  it('zooms in to the bounds of its members when the badge is activated', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const { container } = renderWidget(nearPair());
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      fireEvent.click(badgesOf(container)[0]);
    });
    await waitFor(() => expect(mapOf().getZoom()).toBeGreaterThan(config.defaultViewport.zoom));
    // Leaflet animates the zoom; the end of it lays the markers out again.
    act(() => {
      mapOf().fire('zoomend');
    });
    expect(mapOf().getZoom()).toBeLessThanOrEqual(18);
    expect(badgesOf(container)).toHaveLength(0);
    expect(pinsOf(container)).toHaveLength(2);
  });

  it('activates the badge with Enter as with a click', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const { container } = renderWidget(nearPair());
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      fireEvent.keyPress(badgesOf(container)[0], { key: 'Enter', code: 'Enter', charCode: 13 });
    });
    await waitFor(() => expect(mapOf().getZoom()).toBeGreaterThan(config.defaultViewport.zoom));
  });

  it('lists the members of a badge whose devices share one spot instead of zooming', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const counter: [number, number] = [11.56, 108.54];
    const { container } = renderWidget([
      { ...device('TL-0004', counter), status: 'unheard', subtitle: 'Not heard since handover' },
      { ...device('TL-0005', counter), status: 'incident', subtitle: 'SOS' },
    ]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      fireEvent.click(badgesOf(container)[0]);
    });
    expect(mapOf().getZoom()).toBe(config.defaultViewport.zoom);
    const list = await screen.findByRole('group', { name: '2 devices near 11.5600, 108.5400' });
    // Every device, most severe first, each with its popup content.
    const items = Array.from(list.querySelectorAll('li')).map((item) => item.textContent);
    expect(items).toEqual(['TL-0005SOS', 'TL-0004Not heard since handover']);
    // Focus moves into the scrolling list, so the arrow keys scroll it, and Escape closes it and
    // returns focus to the badge.
    const scroller = screen.getByRole('list', { name: '2 devices near 11.5600, 108.5400' });
    expect(document.activeElement).toBe(scroller);
    act(() => {
      fireEvent.keyDown(scroller, { key: 'Escape' });
    });
    expect(openPopup(mapOf())).toBeUndefined();
    expect(document.activeElement).toBe(badgesOf(container)[0]);
  });

  // Zoomed in, overlapping markers stay at their exact readings, most severe on top.
  it('stacks overlapping markers at their exact readings from zoom 14, the most severe on top', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const sos = { ...device('TL-0010', east(1)), status: 'incident' as const };
    const { container } = renderWidget([device('TL-0009', east(0)), sos]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      mapOf().setZoom(14, { animate: false });
    });
    expect(badgesOf(container)).toHaveLength(0);
    const markers = markersOf(mapOf());
    expect(markers).toHaveLength(2);
    // No offset: each icon sits on its anchor, and each marker on its reading.
    for (const icon of pinsOf(container)) expect(icon.style.marginLeft).toBe('-12px');
    const byName = (id: string) => markers.find((m) => m.options.title?.startsWith(id))!;
    expect(byName('TL-0010').getLatLng().lng).toBeCloseTo(sos.position[1], 12);
    const z = (marker: L.Marker) => Number(marker.getElement()!.style.zIndex);
    expect(z(byName('TL-0010'))).toBeGreaterThan(z(byName('TL-0009')));
    // The top marker carries the count; each names its place in the stack.
    expect(byName('TL-0010').getElement()!.querySelector('.tl-stack-count')?.textContent).toBe('2');
    expect(byName('TL-0009').getElement()!.querySelector('.tl-stack-count')).toBeNull();
    expect(
      screen.getByRole('img', { name: 'TL-0010, Battery 80%, 1 of 2 devices at this spot' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('img', { name: 'TL-0009, Battery 80%, 2 of 2 devices at this spot' }),
    ).toBeTruthy();
  });

  it('opens the list of every device of a stack from any of its markers', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const { container } = renderWidget([
      { ...device('TL-0009', east(0)), links: [{ label: 'Position history', to: '/t/x' }] },
      { ...device('TL-0010', east(1)), status: 'unheard' },
    ]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      mapOf().setZoom(15, { animate: false });
    });
    const below = (await screen.findByRole('img', { name: /^TL-0009, / })).closest<HTMLElement>(
      '.leaflet-marker-icon',
    )!;
    act(() => {
      fireEvent.click(below.querySelector('.tl-marker-target')!);
    });
    const list = await screen.findByRole('group', { name: '2 devices at this spot' });
    expect(Array.from(list.querySelectorAll('li')).map((item) => item.textContent)).toEqual([
      'TL-0010Battery 80%',
      'TL-0009Battery 80%Position history',
    ]);
    // The links stay reachable by keyboard, and the list scrolls from the keyboard.
    expect(list.querySelector('a')?.getAttribute('href')).toBe('/t/x');
    expect(list.querySelector('ul')?.getAttribute('tabindex')).toBe('0');
    expect(openPopup(mapOf())?.getLatLng()?.lng).toBeCloseTo(east(0)[1], 12);
  });

  it('draws the pair apart again four zooms in, and as one badge back out', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const { container } = renderWidget(nearPair());
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    // Four zoom levels in, the readings sit 64 px apart: two plain markers, no stack.
    act(() => {
      mapOf().setZoom(config.defaultViewport.zoom + 4, { animate: false });
    });
    expect(badgesOf(container)).toHaveLength(0);
    expect(pinsOf(container)).toHaveLength(2);
    expect(container.querySelector('.tl-stack-count')).toBeNull();
    expect(screen.getByRole('img', { name: 'TL-0009, Battery 80%' })).toBeTruthy();
    act(() => {
      mapOf().setZoom(config.defaultViewport.zoom, { animate: false });
    });
    expect(badgesOf(container)).toHaveLength(1);
    expect(pinsOf(container)).toHaveLength(0);
  });

  it('shows the "Not heard since handover" chip on the top pin of a stack only', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const unheard = (id: string, position: [number, number]): MapMarker => ({
      ...device(id, position),
      subtitle: 'Not heard since handover',
      status: 'unheard',
    });
    const counter: [number, number] = [11.56, 108.54];
    const { container } = renderWidget([
      unheard('TL-0004', counter),
      unheard('TL-0005', counter),
      unheard('TL-0006', [11.5, 108.5]),
    ]);
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    act(() => {
      mapOf().setView(counter, 14, { animate: false });
    });
    const chipOf = (id: string) =>
      screen
        .getByRole('img', { name: new RegExp(`^${id}, Not heard since handover`) })
        .querySelector<HTMLElement>('.tl-marker-label');
    expect(chipOf('TL-0004')?.style.display).toBe('');
    expect(chipOf('TL-0005')?.style.display).toBe('none');
    expect(chipOf('TL-0006')?.style.display).toBe('');
    expect(chipOf('TL-0006')?.textContent).toBe('Not heard since handover');
  });

  it('zooms to a device chosen in the side list while it is inside a cluster, then opens it', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    giveContainersASize();
    const mapOf = catchMap();
    const markers = nearPair();
    const { container, rerender } = render(tree(markers));
    await waitFor(() => expect(badgesOf(container)).toHaveLength(1));
    rerender(tree(markers, 'TL-0010'));
    await waitFor(() => expect(mapOf().getZoom()).toBe(14));
    act(() => {
      mapOf().fire('zoomend');
    });
    await waitFor(() => expect(openPopup(mapOf())).toBeTruthy());
    expect(openPopup(mapOf())?.getLatLng()?.lng).toBeCloseTo(markers[1].position[1], 12);
  });

  it('leaves a lone marker on its reading, centred in its 24 px target', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { container } = renderWidget([device('TL-0001', [11.5, 108.5])]);
    await waitFor(() =>
      expect(container.querySelector('.leaflet-marker-pane .leaflet-marker-icon')).toBeTruthy(),
    );
    const icon = container.querySelector<HTMLElement>('.leaflet-marker-pane .leaflet-marker-icon')!;
    expect(icon.style.width).toBe('24px');
    expect(icon.style.height).toBe('24px');
    expect(icon.style.marginLeft).toBe('-12px');
    expect(icon.style.marginTop).toBe('-12px');
    // The clipped circle is a child of the focusable box, ahead of the drawn marker (index.css).
    const body = icon.querySelector(':scope > .tl-marker-body');
    expect(body?.firstElementChild?.className).toBe('tl-marker-target');
    expect(body?.querySelector(':scope > [role="img"]')).toBeTruthy();
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
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true })),
    );
    const move = vi.spyOn(L.Marker.prototype, 'setLatLng');
    const { rerender } = render(tree([device('TL-0001', at)]));
    await markerImg();
    rerender(tree([device('TL-0001', near)]));
    expect(frames.size).toBe(0);
    expect(lastMove(move).equals(L.latLng(near))).toBe(true);
  });

  it('cancels a glide when its marker is removed and every glide on unmount', async () => {
    const { rerender, unmount } = render(tree([device('TL-0001', at), device('TL-0002', at)]));
    // The two share one spot, so at zoom 12 they draw as one cluster badge; they still glide under it.
    await screen.findByRole('img', { name: /^2 devices, near / });
    rerender(tree([device('TL-0001', near), device('TL-0002', other)]));
    expect(frames.size).toBe(2);
    rerender(tree([device('TL-0001', near)]));
    expect(frames.size).toBe(1);
    unmount();
    expect(frames.size).toBe(0);
  });
});

// Screen 9.1, W44 (TK-207 staging run 2026-11-07): the keyboard in a marker popup. Enter on a marker
// moves focus into its popup, Escape closes it and returns focus to the marker, Tab cycles inside, and a
// live reading that redraws the popup keeps focus where it was.
describe('LiveMapWidget marker popup keyboard', () => {
  const links = [
    { label: 'Open incident', to: '/o/incidents/INC-1' },
    { label: 'Position history', to: '/o/devices/TL-0018/telemetry' },
  ];
  const sos = (details: string[] = ['Battery 80%']): MapMarker => ({
    ...device('TL-0018', [11.5, 108.5]),
    status: 'incident',
    name: 'TL-0018, SOS, Open, live, Le Thi E',
    details,
    links,
  });
  const markerOf = async () =>
    (await screen.findByRole('img', { name: 'TL-0018, SOS, Open, live, Le Thi E' })).closest(
      '.leaflet-marker-icon',
    ) as HTMLElement;
  const pressEnter = (element: HTMLElement) =>
    act(() => {
      fireEvent.keyPress(element, { key: 'Enter', code: 'Enter', keyCode: 13, charCode: 13 });
    });
  const popupBox = () => document.querySelector<HTMLElement>('.leaflet-popup');
  const closeButton = () =>
    document.querySelector<HTMLElement>('.leaflet-popup-close-button') as HTMLElement;

  it('moves focus to the first link when Enter opens the popup, inside a group named like the marker', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([sos()]);
    const marker = await markerOf();
    marker.focus();
    pressEnter(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Open incident' }));
    expect(screen.getByRole('group', { name: 'TL-0018, SOS, Open, live, Le Thi E' })).toBeTruthy();
  });

  it('focuses the popup content itself when the marker has no link', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([device('TL-0001', [11.5, 108.5])]);
    const marker = (await screen.findByRole('img', { name: 'TL-0001, Battery 80%' })).closest(
      '.leaflet-marker-icon',
    ) as HTMLElement;
    marker.focus();
    pressEnter(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    expect(document.activeElement).toBe(screen.getByRole('group', { name: 'TL-0001, Battery 80%' }));
  });

  it('closes on Escape from a link or from the Close button and returns focus to the marker', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([sos()]);
    const marker = await markerOf();
    for (const from of [
      () => screen.getByRole('link', { name: 'Position history' }),
      () => closeButton(),
    ]) {
      marker.focus();
      pressEnter(marker);
      await waitFor(() => expect(popupBox()).toBeTruthy());
      const start = from();
      start.focus();
      act(() => {
        fireEvent.keyDown(start, { key: 'Escape' });
      });
      expect(popupBox()).toBeNull();
      expect(document.activeElement).toBe(marker);
    }
  });

  it('closes on Escape while the marker that opened it holds focus, as after a pointer opening', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([sos()]);
    const marker = await markerOf();
    fireEvent.click(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    marker.focus();
    act(() => {
      fireEvent.keyDown(marker, { key: 'Escape' });
    });
    expect(popupBox()).toBeNull();
    expect(document.activeElement).toBe(marker);
  });

  it('returns focus to the marker when the Close button closes the popup', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([sos()]);
    const marker = await markerOf();
    marker.focus();
    pressEnter(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    closeButton().focus();
    act(() => {
      fireEvent.click(closeButton());
    });
    expect(popupBox()).toBeNull();
    expect(document.activeElement).toBe(marker);
  });

  it('cycles Tab and Shift+Tab through the links and the Close button', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    renderWidget([sos()]);
    const marker = await markerOf();
    marker.focus();
    pressEnter(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    const first = screen.getByRole('link', { name: 'Open incident' });
    // From the last stop, Tab wraps to the first link.
    closeButton().focus();
    act(() => {
      fireEvent.keyDown(closeButton(), { key: 'Tab' });
    });
    expect(document.activeElement).toBe(first);
    // From the first link, Shift+Tab wraps to the Close button.
    act(() => {
      fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    });
    expect(document.activeElement).toBe(closeButton());
    // Between the stops the browser moves focus itself.
    const second = screen.getByRole('link', { name: 'Position history' });
    second.focus();
    expect(fireEvent.keyDown(second, { key: 'Tab' })).toBe(true);
  });

  it('keeps focus on the same link when a live reading redraws the open popup', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { rerender } = renderWidget([sos(['Battery 80%'])]);
    const marker = await markerOf();
    marker.focus();
    pressEnter(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    screen.getByRole('link', { name: 'Position history' }).focus();
    rerender(tree([sos(['Battery 79%'])]));
    expect(document.querySelector('.leaflet-popup-content')?.textContent).toContain('Battery 79%');
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Position history' }));
    // Escape still closes it and returns focus to the marker.
    act(() => {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    });
    expect(popupBox()).toBeNull();
    expect(document.activeElement).toBe(marker);
  });

  it('leaves focus alone when a live reading redraws a popup that does not hold it', async () => {
    vi.mocked(getMapConfig).mockResolvedValue(config);
    const { rerender } = renderWidget([sos(['Battery 80%'])]);
    const marker = await markerOf();
    fireEvent.click(marker);
    await waitFor(() => expect(popupBox()).toBeTruthy());
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();
    rerender(tree([sos(['Battery 79%'])]));
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });
});
