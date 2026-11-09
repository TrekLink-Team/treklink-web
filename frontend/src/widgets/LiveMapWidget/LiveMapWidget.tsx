import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  MAP_CONFIG_KEY,
  getMapConfig,
  initialBasemap,
  usableBasemaps,
  type Basemap,
  type MapConfig,
} from '../../shared/config/map';
import { cn } from '../../shared/ui/cn';
import { LINK } from '../../shared/ui/styles';
import { createMarkerGlider } from '../../shared/ui/map/glide';
import { markerIcon as systemMarkerIcon } from '../../shared/ui/map/markers';
import {
  CLUSTER_BADGE_PX,
  CLUSTER_REACH_PX,
  CLUSTER_UNTIL_ZOOM,
  SEVERITY_ORDER,
  STACK_REACH_PX,
  clusterName,
  groupPoints,
  nearText,
  severityRank,
} from '../../shared/ui/map/cluster';
import type { MarkerState } from '../../shared/ui/status';

// A link at the foot of a marker popup, such as "Position history" (screen 9.1). `state` travels with
// the navigation when the page hands the widget an `onLink`.
export interface MapLink {
  label: string;
  to: string;
  state?: unknown;
}

export interface MapMarker {
  id: string;
  /** [latitude, longitude], Leaflet order. */
  position: [number, number];
  title: string;
  subtitle?: string;
  /** Drives marker colour; keep in step with device/incident status vocabularies. */
  status?: 'ok' | 'warning' | 'stale' | 'unheard' | 'docked' | 'incident';
  /** Extra popup lines under the subtitle, such as battery and last-seen time. */
  details?: string[];
  /** Links under the popup lines, in order, such as "Open incident" then "Position history"; a marker
   * without any shows the popup as before. */
  links?: MapLink[];
  /** The marker's accessible name, when the page composes one with the state (screen 9.1); without it
   * the name is the title and subtitle. */
  name?: string;
}

// Marker chrome of the TrekLink System (shared/ui/map/markers.ts): shape and colour per state.
const MARKER_STATE: Record<NonNullable<MapMarker['status']>, MarkerState> = {
  ok: 'fresh',
  warning: 'attention',
  stale: 'stale',
  unheard: 'unheard',
  docked: 'docked',
  incident: 'sos',
};

const LEAFLET_CREDIT =
  '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>';

// MSG33: the tile area is replaced; lists elsewhere on the page stay live (FR-MON-09).
const MSG33 = 'The map is unavailable. Device and incident lists are still live.';

// Above markers (600) and below popups (700), so a label is never hidden by a device (BR-30).
const OVERLAY_PANE = 'sovereignty';
const OVERLAY_Z_INDEX = '650';
// Above the tiles (200) and vector paths (400), below markers (600): the opaque area under each label
// that hides the basemap's own names for the archipelagos (D-085, dry run defect 11).
const MASK_PANE = 'sovereignty-mask';
const MASK_Z_INDEX = '450';
// The tiles are not themed, so the mask uses one sea colour on every basemap and both themes. Opaque on
// purpose: any transparency lets a tile label read through.
const MASK_STYLE: L.PathOptions = {
  color: '#2f6f95',
  weight: 1,
  dashArray: '4 4',
  fillColor: '#a9cfe3',
  fillOpacity: 1,
  interactive: false,
};

const textOf = (marker: MapMarker): string =>
  marker.name ?? (marker.subtitle ? `${marker.title}, ${marker.subtitle}` : marker.title);

const overlayIcon = (label: string): L.DivIcon => {
  const element = document.createElement('div');
  element.className =
    'w-max -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-surface px-2 py-0.5 text-xs font-semibold text-status-critical-fg shadow';
  element.textContent = label;
  return L.divIcon({ html: element, className: '', iconSize: [0, 0] });
};

const markerIcon = (marker: MapMarker): L.DivIcon =>
  systemMarkerIcon({
    state: MARKER_STATE[marker.status ?? 'ok'],
    label: marker.title,
    name: textOf(marker),
    // A unit not heard since handover carries its label on the map (MSG41, D-092 rule 2), and so does a
    // unit docked at the counter (devices design section 12.8).
    showChip: marker.status === 'unheard' || marker.status === 'docked',
  });

const stateOf = (marker: MapMarker): MarkerState => MARKER_STATE[marker.status ?? 'ok'];

// The most severe state draws on top wherever markers meet: Leaflet stacks by latitude, so each rank
// lifts a marker past any latitude difference inside a stack.
const Z_PER_RANK = 1000;
const zOffsetOf = (state: MarkerState): number =>
  (SEVERITY_ORDER.length - severityRank(state)) * Z_PER_RANK;

// A cluster badge (leader ruling 2026-11-06): a 44 px round icon with the device count, its ring in the
// colour of the most severe state inside, and an SOS flag when one is there, so the state is not shown
// by colour alone. The count is dark on white in both themes, as the tiles are light in both.
const clusterIcon = (state: MarkerState, count: number, name: string): L.DivIcon => {
  const element = document.createElement('div');
  element.className = `tl-cluster tl-cluster--${state}`;
  element.setAttribute('role', 'img');
  element.setAttribute('aria-label', name);
  const text = document.createElement('span');
  text.setAttribute('aria-hidden', 'true');
  text.textContent = String(count);
  element.append(text);
  if (state === 'sos') {
    const flag = document.createElement('span');
    flag.className = 'tl-cluster-flag';
    flag.setAttribute('aria-hidden', 'true');
    flag.textContent = 'SOS';
    element.append(flag);
  }
  const centre = CLUSTER_BADGE_PX / 2;
  return L.divIcon({
    html: element,
    className: 'tl-cluster-hit',
    iconSize: [CLUSTER_BADGE_PX, CLUSTER_BADGE_PX],
    iconAnchor: [centre, centre],
  });
};

// Opens a popup link: true when the page took the navigation, false to let the browser follow the href.
type OpenLink = (link: MapLink) => boolean;

const popupContent = (marker: MapMarker, openLink: OpenLink): HTMLElement => {
  const element = document.createElement('div');
  const title = document.createElement('p');
  title.className = 'font-semibold text-sm';
  title.textContent = marker.title;
  element.append(title);
  for (const line of [marker.subtitle, ...(marker.details ?? [])]) {
    if (!line) continue;
    const text = document.createElement('p');
    text.className = 'text-xs text-ink-muted';
    text.textContent = line;
    element.append(text);
  }
  for (const link of marker.links ?? []) {
    const anchor = document.createElement('a');
    anchor.href = link.to;
    anchor.textContent = link.label;
    // A 24 by 24 px target at least (WCAG 2.2, 2.5.8), the text centred in it. The 4 px top margin keeps
    // the focus ring clear of the line above.
    anchor.className = `mt-1 inline-flex min-h-6 min-w-6 items-center text-xs ${LINK}`;
    // A plain click stays in the single-page app; a modified click opens a tab as any link does.
    anchor.addEventListener('click', (event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return;
      if (openLink(link)) event.preventDefault();
    });
    const line = document.createElement('p');
    line.append(anchor);
    element.append(line);
  }
  return element;
};

// The root of a popup's content: it takes focus when the popup has nothing focusable to offer. Escape,
// Tab and the return of focus are handled for the whole map in LeafletMap (screen 9.1).
const popupRoot = (element: HTMLElement): HTMLElement => {
  element.tabIndex = -1;
  element.classList.add('outline-none');
  return element;
};

// A lone marker's popup is a group named like its marker, so a screen reader entering it hears which
// device it belongs to before the first link.
const singleContent = (marker: MapMarker, openLink: OpenLink): HTMLElement => {
  const element = popupContent(marker, openLink);
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', textOf(marker));
  return element;
};

// Where focus lands when a popup opens: the list of a stack or a cluster, so it scrolls from the
// keyboard; else the first link, such as "Open incident"; else the content itself.
const entryOf = (root: HTMLElement): HTMLElement =>
  root.querySelector<HTMLElement>('.tl-map-list') ?? root.querySelector<HTMLElement>('a[href]') ?? root;

// Every element of a popup that can hold focus, the content root first, in document order. A rebuilt
// popup has the same shape, so a place in this list survives the rebuild.
const placesOf = (root: HTMLElement): HTMLElement[] => [
  root,
  ...root.querySelectorAll<HTMLElement>('a[href], [tabindex]'),
];

// The Tab stops of an open popup: its links, its list and Leaflet's Close button, in document order.
const tabStopsOf = (box: HTMLElement): HTMLElement[] =>
  [...box.querySelectorAll<HTMLElement>('a[href], button, [tabindex]')].filter(
    (element) => element.tabIndex >= 0 && !element.hasAttribute('disabled'),
  );

// A live reading redraws the content of an open popup. The keyboard stays where it was: the element at
// the same place in the new content takes focus, and a list keeps its scroll position.
const swapContent = (popup: L.Popup | undefined, next: HTMLElement) => {
  if (!popup) return;
  const old = popup.isOpen() ? popup.getContent() : undefined;
  const active = document.activeElement;
  const place =
    old instanceof HTMLElement && active instanceof HTMLElement && old.contains(active)
      ? placesOf(old).indexOf(active)
      : -1;
  const scroll = old instanceof HTMLElement ? old.querySelector('.tl-map-list')?.scrollTop : 0;
  popup.setContent(next);
  const list = next.querySelector<HTMLElement>('.tl-map-list');
  if (list && scroll) list.scrollTop = scroll;
  if (place >= 0) (placesOf(next)[place] ?? next).focus({ preventScroll: true });
};

// Every device of a stack or a cluster, each with its own popup content, in severity order (leader
// ruling 2026-11-06), so no device under another is out of reach. The list scrolls inside the popup
// and takes focus itself, so it scrolls from the keyboard even when no entry has a link.
const listContent = (
  members: MapMarker[],
  heading: string,
  openLink: OpenLink,
  map: L.Map,
): HTMLElement => {
  const element = document.createElement('div');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', heading);
  const title = document.createElement('p');
  title.className = 'font-semibold text-sm';
  title.textContent = heading;
  element.append(title);
  const list = document.createElement('ul');
  list.className = 'tl-map-list mt-1 overflow-y-auto divide-y divide-line pr-1';
  list.tabIndex = 0;
  list.setAttribute('aria-label', heading);
  // The list fits the map it opens on: a phone's map is about 320 px high, so the list scrolls inside
  // the popup instead of reaching past the map box. Set before the popup opens, so Leaflet pans for it.
  list.style.maxHeight = `${Math.min(LIST_MAX_PX, Math.max(LIST_MIN_PX, map.getSize().y - 190))}px`;
  for (const member of members) {
    const item = document.createElement('li');
    item.className = 'py-1.5';
    item.append(popupContent(member, openLink));
    list.append(item);
  }
  element.append(list);
  return element;
};

const stackHeading = (count: number): string => `${count} devices at this spot`;
// Height limits of that list in CSS px; within them it follows the map's height.
const LIST_MAX_PX = 256;
const LIST_MIN_PX = 96;

// What a marker shows besides its position; a change redraws its icon and popup.
const lookOf = (marker: MapMarker): string =>
  JSON.stringify([
    marker.title,
    marker.subtitle,
    marker.status,
    marker.details,
    marker.links?.map((link) => [link.label, link.to]),
    marker.name,
  ]);

const Unavailable: React.FC<{ overlay: MapConfig['sovereigntyOverlay'] }> = ({ overlay }) => (
  <div
    role="alert"
    className="absolute inset-0 z-[800] flex flex-col items-center justify-center gap-1 bg-sunken p-4 text-center"
  >
    <p className="text-body font-semibold text-ink">{MSG33}</p>
    {overlay.length > 0 && (
      <ul className="text-body-sm text-ink-muted">
        {overlay.map((place) => (
          <li key={place.label}>{place.label}</li>
        ))}
      </ul>
    )}
  </div>
);

// A device's track (screen 9.2): the line through its plotted positions. A fixed blue on purpose, like
// MASK_STYLE: the tiles are not themed, and the accent token turns pale lime in the dark theme, which
// would vanish on light tiles. This blue holds its contrast on every basemap in both themes, and it is
// no status colour, so a track never reads as an alert.
const TRACK_STYLE: L.PolylineOptions = { color: '#1d4ed8', weight: 3, opacity: 0.85 };

// Where a map opens instead of the configured viewport, such as one device's last position.
export interface MapView {
  /** [latitude, longitude], Leaflet order. */
  center: [number, number];
  zoom: number;
}

// Leaflet draws its controls above popups, so a popup pans clear of the zoom buttons at the top left
// and is no wider than the map beside them; on a 360 px phone the map is about 320 px wide. maxWidth
// caps the content only: Leaflet's popup adds its margins (20 px left, 24 px right) and a 1 px border
// on each side, and without them in the sum the Close button ended outside a phone's map (W44).
const CONTROL_CLEARANCE_PX = 58;
const POPUP_CHROME_PX = 46;
const popupFit = (map: L.Map): Pick<L.PopupOptions, 'maxWidth' | 'autoPanPaddingTopLeft'> => ({
  maxWidth: Math.max(
    160,
    Math.min(300, map.getSize().x - CONTROL_CLEARANCE_PX - POPUP_CHROME_PX - 16),
  ),
  autoPanPaddingTopLeft: [CONTROL_CLEARANCE_PX, 8],
});

interface Badge {
  marker: L.Marker;
  /** Member ids, most severe first. */
  ids: string[];
  near: string;
  look: string;
}

// A stacked marker keeps its reading and its icon. Only the top one shows its "Not heard since
// handover" chip, so chips do not cover each other, and it carries the count of the stack; each member
// adds its place in the stack to its accessible name. The chip and the count are aria-hidden, so the
// name, the popup list and the device list keep the state.
const decorateStacked = (
  marker: L.Marker,
  m: MapMarker,
  stack: { index: number; count: number } | null,
) => {
  const element = marker.getElement();
  if (!element) return;
  const chip = element.querySelector<HTMLElement>('.tl-marker--unheard + .tl-marker-label');
  if (chip) chip.style.display = stack && stack.index > 0 ? 'none' : '';
  const name = stack
    ? `${textOf(m)}, ${stack.index + 1} of ${stack.count} devices at this spot`
    : textOf(m);
  element.querySelector('[role="img"]')?.setAttribute('aria-label', name);
  // The focusable marker element is named by its title, so it carries the place in the stack too
  // (treklink-web#443); Leaflet reads the option again when it redraws the icon.
  marker.options.title = name;
  element.setAttribute('title', name);
  const body = element.querySelector('.tl-marker-body');
  let count = body?.querySelector<HTMLElement>(':scope > .tl-stack-count') ?? null;
  if (stack && stack.index === 0) {
    if (!count && body) {
      count = document.createElement('span');
      count.className = 'tl-stack-count';
      count.setAttribute('aria-hidden', 'true');
      body.append(count);
    }
    if (count) count.textContent = String(stack.count);
  } else count?.remove();
};

const LeafletMap: React.FC<{
  config: MapConfig;
  markers: MapMarker[];
  selectedId?: string | null;
  track?: [number, number][];
  onLink?: (link: MapLink) => void;
  view?: MapView;
  compact?: boolean;
  cardMode?: boolean;
  onSelect?: (id: string | null) => void;
  onPopupChange?: (open: boolean) => void;
}> = ({
  config,
  markers,
  selectedId,
  track,
  onLink,
  view,
  compact = false,
  cardMode = false,
  onSelect,
  onPopupChange,
}) => {
  const [map, setMap] = useState<L.Map | null>(null);
  const [tilesFailed, setTilesFailed] = useState(false);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const looks = useRef<Map<string, string>>(new Map());
  // The latest reading per marker; mid-glide the marker itself is still on its way there.
  const targets = useRef<Map<string, [number, number]>>(new Map());
  const glider = useMemo(() => (map ? createMarkerGlider(map) : null), [map]);
  // A popup is built once per look, so its link reads the latest handler through a ref.
  const onLinkRef = useRef(onLink);
  useEffect(() => {
    onLinkRef.current = onLink;
  }, [onLink]);
  // On a phone the page shows a single device as a card under the map (screen 9.1), so a marker alone at
  // its spot reports the tap instead of opening a popup. A stack or a cluster still opens its list.
  const onSelectRef = useRef(onSelect);
  const cardModeRef = useRef(cardMode);
  const cardIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const onPopupRef = useRef(onPopupChange);
  useEffect(() => {
    onPopupRef.current = onPopupChange;
  }, [onPopupChange]);
  // The opening view and the compact flag are read once, when the map is built; a later view moves the
  // map in the effect below rather than rebuilding it.
  const opening = useRef({ view, compact });
  const openLink = useCallback<OpenLink>((link) => {
    if (!onLinkRef.current) return false;
    onLinkRef.current(link);
    return true;
  }, []);

  // The map is created in a callback ref: creation needs the DOM node, and reporting a tile failure
  // sets state, which an effect body should not do synchronously.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) return;
      const { view: openingView, compact: small } = opening.current;
      const { lat, lon, zoom } = config.defaultViewport;
      // A small map inside a page (a device's last position) leaves the wheel and, on a phone, one
      // finger to the page, so the page still scrolls over it; the zoom buttons stay.
      const instance = L.map(node, {
        scrollWheelZoom: !small,
        dragging: !(small && L.Browser.mobile),
      }).setView(openingView?.center ?? [lat, lon], openingView?.zoom ?? zoom);
      // A plain Leaflet credit: the library's default prefix adds a national flag icon, a political
      // symbol with no place on a TrekLink map (dry run 2026-10-30, MF-02 step 3).
      instance.attributionControl.setPrefix(LEAFLET_CREDIT);

      // One tile layer per basemap, in the server's order, opening on the default or, when the default
      // is not offered, on the first basemap (D-072). A hidden basemap is left out, and a localOnly one
      // off loopback. Only the active layer is on the map, so only it reports loads and failures.
      const basemaps: Basemap[] = config.basemaps.length
        ? usableBasemaps(config.basemaps)
        : [
            {
              id: config.provider,
              name: config.provider,
              tileUrl: config.tileUrl,
              attribution: config.attribution,
              maxZoom: 18,
              maxNativeZoom: 18,
            },
          ];
      // One failed tile is normal on a flaky link. The panel appears only when a whole batch of tiles
      // finishes without a single success, and goes as soon as one tile loads (REQ-EVT-04).
      let loadedInBatch = 0;
      const layers: Record<string, L.TileLayer> = {};
      for (const basemap of basemaps) {
        const tiles = L.tileLayer(basemap.tileUrl, {
          attribution: basemap.attribution,
          maxZoom: basemap.maxZoom,
          maxNativeZoom: basemap.maxNativeZoom,
        });
        tiles.on('loading', () => {
          loadedInBatch = 0;
        });
        tiles.on('tileload', () => {
          loadedInBatch += 1;
          setTilesFailed(false);
        });
        tiles.on('load', () => {
          if (loadedInBatch === 0) setTilesFailed(true);
        });
        layers[basemap.name] = tiles;
      }
      const initial = initialBasemap(basemaps, config.provider);
      layers[initial.name].addTo(instance);
      // Base layers only: the sovereignty overlay is never offered for switching off (REQ-UBI-06).
      if (basemaps.length > 1)
        L.control.layers(layers, undefined, { collapsed: small }).addTo(instance);
      instance.on('baselayerchange', () => setTilesFailed(false));

      // Always on, never in a layer control, never removed by the user (REQ-UBI-06). The mask goes
      // first, under the label, with its own SVG renderer so it stays in its pane.
      const maskPane = instance.createPane(MASK_PANE);
      maskPane.style.zIndex = MASK_Z_INDEX;
      maskPane.style.pointerEvents = 'none';
      const maskRenderer = L.svg({ pane: MASK_PANE });
      for (const place of config.sovereigntyOverlay) {
        if (place.mask.length < 3) continue;
        L.polygon(place.mask, { ...MASK_STYLE, pane: MASK_PANE, renderer: maskRenderer }).addTo(
          instance,
        );
      }
      const pane = instance.createPane(OVERLAY_PANE);
      pane.style.zIndex = OVERLAY_Z_INDEX;
      pane.style.pointerEvents = 'none';
      const overlay = L.layerGroup().addTo(instance);
      for (const place of config.sovereigntyOverlay) {
        L.marker([place.lat, place.lon], {
          icon: overlayIcon(place.label),
          pane: OVERLAY_PANE,
          interactive: false,
          keyboard: false,
        }).addTo(overlay);
      }
      setMap(instance);
    },
    [config],
  );

  // What layoutMarkers last drew: the badge per cluster key, the popup content key per marker, and a
  // device to open once a zoom has drawn it.
  const badges = useRef<Map<string, Badge>>(new Map());
  const popupKeys = useRef<Map<string, string>>(new Map());
  const data = useRef<Map<string, MapMarker>>(new Map());
  const pendingOpen = useRef<string | null>(null);
  const listPopup = useRef<{ key: string; popup: L.Popup } | null>(null);
  // The first member of a badge the keyboard just activated: the badge is replaced as the map zooms,
  // so focus moves to that member (or the smaller badge now holding it) instead of falling to the
  // page body (treklink-web#447, WCAG 2.4.3).
  const focusAfterZoom = useRef<string | null>(null);
  // The open popup and the marker or badge that opened it, which takes focus back when it closes.
  const opened = useRef<{ popup: L.Popup; opener: () => HTMLElement | null | undefined } | null>(
    null,
  );

  useEffect(() => {
    if (!map) return;
    const tracked = markerRefs.current;
    const tracedLooks = looks.current;
    const tracedTargets = targets.current;
    const tracedBadges = badges.current;
    const tracedKeys = popupKeys.current;
    const tracedData = data.current;
    const tracedCards = cardIds.current;
    return () => {
      glider?.cancelAll();
      tracked.clear();
      tracedLooks.clear();
      tracedTargets.clear();
      tracedBadges.clear();
      tracedKeys.clear();
      tracedData.clear();
      tracedCards.clear();
      map.remove();
    };
  }, [map, glider]);

  // A cluster badge, clicked or activated with Enter: zoom in to the bounds of its members, or, when the
  // map cannot come closer (the maximum zoom, or members that share one spot), list them in a popup.
  const activateBadge = useCallback(
    (key: string) => {
      const badge = badges.current.get(key);
      if (!map || !badge) return;
      const readings = badge.ids.map((id) =>
        L.latLng(targets.current.get(id) ?? markerRefs.current.get(id)!.getLatLng()),
      );
      const bounds = L.latLngBounds(readings);
      const max = map.getMaxZoom();
      const zoom = map.getZoom();
      if (zoom >= max || bounds.getNorthEast().equals(bounds.getSouthWest())) {
        const members = badge.ids.map((id) => data.current.get(id)!);
        const heading = `${members.length} devices near ${badge.near}`;
        const content = popupRoot(listContent(members, heading, openLink, map));
        const popup = L.popup({ ...popupFit(map), offset: [0, -CLUSTER_BADGE_PX / 2 + 4] })
          .setLatLng(badge.marker.getLatLng())
          .setContent(content)
          .openOn(map);
        listPopup.current = { key, popup };
        opened.current = { popup, opener: () => badges.current.get(key)?.marker.getElement() };
        entryOf(content).focus({ preventScroll: true });
        return;
      }
      if (document.activeElement === badge.marker.getElement())
        focusAfterZoom.current = badge.ids[0] ?? null;
      const fit = map.getBoundsZoom(bounds, false, L.point(CLUSTER_REACH_PX, CLUSTER_REACH_PX));
      const next = Math.min(max, Math.max(Number.isFinite(fit) ? fit : zoom + 2, zoom + 1));
      map.setView(bounds.getCenter(), next);
    },
    [map, openLink],
  );

  // Clusters zoomed out, stacks zoomed in (leader ruling 2026-11-06). No marker ever leaves its reading:
  // markers whose targets sit within CLUSTER_REACH_PX of each other below CLUSTER_UNTIL_ZOOM are taken
  // off the map and drawn as one badge at their centroid; from that zoom up, markers within
  // STACK_REACH_PX stay where they are, the most severe on top, and each opens the list of the stack.
  // Pixel distances change with the zoom, so this runs after every reconcile and every zoom.
  const layoutMarkers = useCallback(() => {
    if (!map) return;
    const zoom = map.getZoom();
    const clustering = zoom < Math.min(CLUSTER_UNTIL_ZOOM, map.getMaxZoom());
    const points = [...markerRefs.current].flatMap(([id, marker]) => {
      const m = data.current.get(id);
      if (!m) return [];
      const { iconSize, iconAnchor } = marker.getIcon().options;
      const size = L.point(iconSize ?? [0, 0]);
      const anchor = L.point(iconAnchor ?? [size.x / 2, size.y / 2]);
      // The centre of the target, which for a pin sits above the reading.
      const at = map
        .project(targets.current.get(id) ?? marker.getLatLng(), zoom)
        .add([size.x / 2 - anchor.x, size.y / 2 - anchor.y]);
      return [{ id, x: at.x, y: at.y, state: stateOf(m) }];
    });
    const groups = groupPoints(points, clustering ? CLUSTER_REACH_PX : STACK_REACH_PX);
    const drawnBadges = new Set<string>();

    for (const group of groups) {
      const members = group.ids.map((id) => data.current.get(id)!);
      if (clustering && members.length > 1) {
        for (const id of group.ids) markerRefs.current.get(id)?.remove();
        const key = [...group.ids].sort().join('|');
        drawnBadges.add(key);
        const readings = group.ids.map(
          (id) => targets.current.get(id) ?? markerRefs.current.get(id)!.getLatLng(),
        );
        const centre = L.latLng(
          readings.reduce((sum, at) => sum + L.latLng(at).lat, 0) / readings.length,
          readings.reduce((sum, at) => sum + L.latLng(at).lng, 0) / readings.length,
        );
        const near = nearText(centre.lat, centre.lng);
        const name = clusterName(members.map(stateOf), near);
        const look = JSON.stringify([group.state, name]);
        const existing = badges.current.get(key);
        if (existing) {
          existing.marker.setLatLng(centre);
          if (existing.look !== look) {
            existing.marker.options.title = name;
            existing.marker.setIcon(clusterIcon(group.state, members.length, name));
            existing.marker.setZIndexOffset(zOffsetOf(group.state));
          }
          Object.assign(existing, { ids: group.ids, near, look });
          continue;
        }
        const badge: Badge = {
          marker: L.marker(centre, {
            icon: clusterIcon(group.state, members.length, name),
            title: name,
            zIndexOffset: zOffsetOf(group.state),
          }),
          ids: group.ids,
          near,
          look,
        };
        badge.marker.on('click', () => activateBadge(key));
        // Leaflet turns Enter into a click only for a marker with a popup bound.
        badge.marker.on('keypress', (event: L.LeafletKeyboardEvent) => {
          if (event.originalEvent.key === 'Enter') activateBadge(key);
        });
        badge.marker.addTo(map);
        badges.current.set(key, badge);
        continue;
      }

      const stacked = members.length > 1;
      const stackKey = stacked
        ? JSON.stringify(['stack', ...members.map((m) => [m.id, looks.current.get(m.id)])])
        : null;
      group.ids.forEach((id, index) => {
        const marker = markerRefs.current.get(id)!;
        const m = members[index];
        if (!map.hasLayer(marker)) marker.addTo(map);
        marker.setZIndexOffset(
          zOffsetOf(stateOf(m)) + (stacked && index === 0 ? Z_PER_RANK / 2 : 0),
        );
        // A marker alone at its spot is a card on a phone: no popup, and the tap goes to the page.
        const card = cardModeRef.current && !stacked;
        if (card) {
          if (marker.getPopup()) {
            marker.closePopup();
            marker.unbindPopup();
            popupKeys.current.delete(id);
          }
          cardIds.current.add(id);
        } else {
          if (!marker.getPopup()) {
            marker.bindPopup('', { offset: [0, -4] });
            popupKeys.current.delete(id);
          }
          cardIds.current.delete(id);
        }
        const contentKey = stackKey ?? looks.current.get(id) ?? '';
        Object.assign(marker.getPopup()?.options ?? {}, popupFit(map));
        if (!card && popupKeys.current.get(id) !== contentKey) {
          swapContent(
            marker.getPopup(),
            popupRoot(
              stacked
                ? listContent(members, stackHeading(members.length), openLink, map)
                : singleContent(m, openLink),
            ),
          );
          popupKeys.current.set(id, contentKey);
        }
        decorateStacked(marker, m, stacked ? { index, count: members.length } : null);
      });
    }

    for (const [key, badge] of badges.current) {
      if (drawnBadges.has(key)) continue;
      badge.marker.remove();
      badges.current.delete(key);
      if (listPopup.current?.key === key) {
        listPopup.current.popup.remove();
        listPopup.current = null;
      }
    }

    const keep = focusAfterZoom.current;
    if (keep) {
      const own = markerRefs.current.get(keep);
      const holder = [...badges.current].find(([key]) => key.split('|').includes(keep))?.[1].marker;
      const target = own && map.hasLayer(own) ? own : holder;
      const element = target?.getElement();
      if (element) {
        focusAfterZoom.current = null;
        element.focus({ preventScroll: true });
      }
    }

    const waiting = pendingOpen.current;
    const shown = waiting ? markerRefs.current.get(waiting) : undefined;
    if (shown && map.hasLayer(shown)) {
      pendingOpen.current = null;
      shown.openPopup();
    }
  }, [map, openLink, activateBadge]);

  // Reconcile markers against the current set: update in place, add new, remove departed. A moved
  // marker glides to its new reading; a new one is placed at once. layoutMarkers then puts each marker
  // on the map, in a cluster or in a stack.
  useEffect(() => {
    if (!map || !glider) return;
    const seen = new Set<string>();

    for (const m of markers) {
      seen.add(m.id);
      targets.current.set(m.id, m.position);
      data.current.set(m.id, m);
      const look = lookOf(m);
      const existing = markerRefs.current.get(m.id);
      if (existing) {
        glider.moveTo(existing, m.position);
        if (looks.current.get(m.id) !== look) {
          // Leaflet reads the title and alt from the options when it redraws the icon.
          existing.options.title = textOf(m);
          existing.options.alt = textOf(m);
          existing.setIcon(markerIcon(m));
          looks.current.set(m.id, look);
        }
        continue;
      }
      const marker = L.marker(m.position, {
        icon: markerIcon(m),
        title: textOf(m),
        alt: textOf(m),
      }).bindPopup('', { offset: [0, -4] });
      // Focus moves into a popup opened from the marker, by pointer, Enter or the side list, and comes
      // back to the marker when the popup closes (screen 9.1).
      marker.on('popupopen', (event) => {
        opened.current = { popup: event.popup, opener: () => markerRefs.current.get(m.id)?.getElement() };
        const content = event.popup.getContent();
        if (content instanceof HTMLElement) entryOf(content).focus({ preventScroll: true });
      });
      marker.on('click', () => {
        if (cardIds.current.has(m.id)) onSelectRef.current?.(m.id);
      });
      // Leaflet turns Enter into a click only for a marker with a popup bound, which a card has not.
      marker.on('keypress', (event: L.LeafletKeyboardEvent) => {
        if (event.originalEvent.key === 'Enter' && cardIds.current.has(m.id)) {
          onSelectRef.current?.(m.id);
        }
      });
      markerRefs.current.set(m.id, marker);
      looks.current.set(m.id, look);
    }

    for (const [id, marker] of markerRefs.current) {
      if (!seen.has(id)) {
        glider.cancel(marker);
        marker.remove();
        markerRefs.current.delete(id);
        looks.current.delete(id);
        targets.current.delete(id);
        popupKeys.current.delete(id);
        data.current.delete(id);
      }
    }
    layoutMarkers();
  }, [map, glider, markers, layoutMarkers]);

  useEffect(() => {
    if (!map) return;
    map.on('zoomend viewreset', layoutMarkers);
    return () => {
      map.off('zoomend viewreset', layoutMarkers);
    };
  }, [map, layoutMarkers]);

  // Crossing the phone breakpoint turns popups into cards and back, so the markers are laid out again.
  useEffect(() => {
    cardModeRef.current = cardMode;
    layoutMarkers();
  }, [cardMode, layoutMarkers]);

  // The keyboard in an open popup (screen 9.1; WCAG 2.1.1, 2.4.3, 1.4.13). Escape closes it from inside
  // the popup or from the marker that opened it, and focus goes back to that marker; Tab and Shift+Tab
  // cycle through the popup's links, its list and its Close button. Leaflet's own Escape only works
  // while the map box itself has focus. A popup closed any other way while it held focus, by its Close
  // button for one, also hands focus back to its marker.
  useEffect(() => {
    if (!map) return;
    const container = map.getContainer();
    let focusInside = false;
    const current = () => (opened.current?.popup.isOpen() ? opened.current : null);
    const onKeyDown = (event: KeyboardEvent) => {
      const open = current();
      if (!open) return;
      const box = open.popup.getElement();
      const target = event.target instanceof Node ? event.target : null;
      const inside = !!box && !!target && box.contains(target);
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        const back = inside || target === open.opener();
        map.closePopup(open.popup);
        if (back) open.opener()?.focus({ preventScroll: true });
        return;
      }
      if (event.key !== 'Tab' || !inside || !box) return;
      const stops = tabStopsOf(box);
      if (stops.length === 0) return;
      const active = document.activeElement as HTMLElement | null;
      const edge = event.shiftKey ? stops[0] : stops[stops.length - 1];
      // Shift+Tab from the content root, which is no Tab stop, also wraps to the Close button.
      if (active === edge || (event.shiftKey && !stops.includes(active as HTMLElement))) {
        event.preventDefault();
        (event.shiftKey ? stops[stops.length - 1] : stops[0]).focus({ preventScroll: true });
      }
    };
    const onFocusIn = (event: FocusEvent) => {
      const box = current()?.popup.getElement();
      focusInside = !!box && event.target instanceof Node && box.contains(event.target);
    };
    const onFocusOut = (event: FocusEvent) => {
      // Focus that leaves the map; a removed element reports no next target and keeps the flag.
      if (event.relatedTarget instanceof Node && !container.contains(event.relatedTarget))
        focusInside = false;
    };
    const onClose = (event: L.PopupEvent) => {
      const open = opened.current;
      if (!open || open.popup !== event.popup) return;
      opened.current = null;
      const active = document.activeElement;
      const box = event.popup.getElement();
      const held =
        (!!box && !!active && box.contains(active)) ||
        ((!active || active === document.body) && focusInside);
      focusInside = false;
      if (held) open.opener()?.focus({ preventScroll: true });
    };
    container.addEventListener('keydown', onKeyDown);
    container.addEventListener('focusin', onFocusIn);
    container.addEventListener('focusout', onFocusOut);
    map.on('popupclose', onClose);
    return () => {
      container.removeEventListener('keydown', onKeyDown);
      container.removeEventListener('focusin', onFocusIn);
      container.removeEventListener('focusout', onFocusOut);
      map.off('popupclose', onClose);
    };
  }, [map]);

  // The page hears when a popup opens and closes, so it can move what it draws over the map aside.
  useEffect(() => {
    if (!map) return;
    const opens = () => onPopupRef.current?.(true);
    const closes = () => onPopupRef.current?.(false);
    map.on('popupopen', opens);
    map.on('popupclose', closes);
    return () => {
      map.off('popupopen', opens);
      map.off('popupclose', closes);
    };
  }, [map]);

  // A tap on the map outside any marker puts the card away.
  useEffect(() => {
    if (!map) return;
    const away = () => {
      if (cardModeRef.current) onSelectRef.current?.(null);
    };
    map.on('click', away);
    return () => {
      map.off('click', away);
    };
  }, [map]);

  // The track of a history screen: a line through the positions, with the map fitted to it. Nothing is
  // drawn for fewer than two points, and the line goes when the track does.
  useEffect(() => {
    if (!map || !track || track.length < 2) return;
    const line = L.polyline(track, TRACK_STYLE).addTo(map);
    map.fitBounds(line.getBounds(), { padding: [24, 24] });
    return () => {
      line.remove();
    };
  }, [map, track]);

  // A new opening view, such as a device that reported a new position, moves the map there.
  const centerLat = view?.center[0];
  const centerLon = view?.center[1];
  const viewZoom = view?.zoom;
  useEffect(() => {
    if (!map || centerLat === undefined || centerLon === undefined) return;
    map.setView([centerLat, centerLon], viewZoom ?? map.getZoom());
  }, [map, centerLat, centerLon, viewZoom]);

  // A device chosen in a list beside the map: centre on its latest reading, where a gliding marker is
  // heading, and open its popup.
  useEffect(() => {
    if (!map || !selectedId) return;
    const marker = markerRefs.current.get(selectedId);
    if (!marker) return;
    const at = targets.current.get(selectedId) ?? marker.getLatLng();
    if (map.hasLayer(marker)) {
      map.panTo(at);
      marker.openPopup();
      return;
    }
    // Inside a cluster: zoom to where it no longer clusters; layoutMarkers opens it once drawn.
    pendingOpen.current = selectedId;
    map.setView(at, Math.max(map.getZoom(), Math.min(CLUSTER_UNTIL_ZOOM, map.getMaxZoom())));
  }, [map, selectedId]);

  return (
    <>
      <div ref={containerRef} className="w-full h-full" />
      {tilesFailed && <Unavailable overlay={config.sovereigntyOverlay} />}
    </>
  );
};

/**
 * Live operational map (MF-04, task 1.3).
 *
 * Leaflet over the basemaps that GET /api/map/config returns, switchable in a layer control, with the
 * Vietnamese sovereignty overlay always drawn on top of every basemap (D-031, D-072). If the config or the tiles fail, the panel shows
 * MSG33 and the rest of the page keeps working.
 */
export const LiveMapWidget: React.FC<{
  markers?: MapMarker[];
  /** The marker to centre on and open, chosen outside the map (screen 9.1 side panel). */
  selectedId?: string | null;
  /** A line through [latitude, longitude] points, drawn under the markers and fitted to the view. */
  track?: [number, number][];
  /** Follows a popup link inside the app (React Router); without it the browser follows the href. */
  onLink?: (link: MapLink) => void;
  /** Opens the map here instead of the configured viewport. */
  view?: MapView;
  /** A small map inside a page: the layer control starts collapsed, and the wheel scrolls the page. */
  compact?: boolean;
  /** A phone: a marker alone at its spot reports its tap to `onSelect` instead of opening a popup, and
   * a tap on the bare map reports null. The page shows the device as a card (screen 9.1). */
  cardMode?: boolean;
  onSelect?: (id: string | null) => void;
  /** Reports true when a popup opens and false when it closes, for a page that draws over the map. */
  onPopupChange?: (open: boolean) => void;
  /** Size of the map box. The default keeps the interim dashboard's height; a full-bleed map page
   * passes `h-full` inside MapWorkspace. */
  className?: string;
}> = ({
  markers = [],
  selectedId = null,
  track,
  onLink,
  view,
  compact,
  cardMode,
  onSelect,
  onPopupChange,
  className,
}) => {
  const config = useQuery({
    queryKey: MAP_CONFIG_KEY,
    queryFn: getMapConfig,
    retry: false,
    // The map is built once from this config; a refetch must not hand it a new one mid-session.
    staleTime: Infinity,
  });

  return (
    <div
      className={cn(
        'relative h-[500px] w-full overflow-hidden rounded-panel border border-line bg-sunken shadow-raise',
        className,
      )}
    >
      {config.data && (
        <LeafletMap
          key={config.data.tileUrl}
          config={config.data}
          markers={markers}
          selectedId={selectedId}
          track={track}
          onLink={onLink}
          view={view}
          compact={compact}
          cardMode={cardMode}
          onSelect={onSelect}
          onPopupChange={onPopupChange}
        />
      )}
      {config.isPending && (
        <p className="absolute inset-0 flex items-center justify-center text-body text-ink-muted">
          Loading map
        </p>
      )}
      {config.isError && <Unavailable overlay={[]} />}
    </div>
  );
};
