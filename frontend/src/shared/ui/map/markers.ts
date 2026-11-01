import L from 'leaflet';
import { MARKER_LABEL, type MarkerState } from '../status';

// Live device markers of the TrekLink System (DS-12, convention 06 §4 Pattern B). Shape carries the
// state as well as colour: a circle when live, a dashed circle when offline (with the last-seen time
// beside it), a pin with the chip "Not heard since handover" for a unit not heard since its handover
// (D-092 rule 2), a pulsing diamond for SOS. Markers keep their colours in both themes because the
// basemap tiles are light in both.

export interface MarkerOptions {
  state: MarkerState;
  /** Device label and holder, read by screen readers: "TL-0417, Le Thi E". */
  label: string;
  /** For stale markers: "14 min", shown beside the marker and appended to the label. */
  lastSeen?: string;
  /** Shows the label chip next to SOS and not-heard markers. On by default for both. */
  showChip?: boolean;
  /** Overrides the accessible name, for callers that already compose one. */
  name?: string;
}

/** The accessible name of a marker: label, state and, when stale, the last-seen time. */
export const markerName = ({ state, label, lastSeen }: MarkerOptions): string =>
  [label, MARKER_LABEL[state], state === 'stale' && lastSeen ? `last seen ${lastSeen} ago` : null]
    .filter(Boolean)
    .join(', ');

/** The marker element, for Leaflet or for a legend. */
export const markerElement = (options: MarkerOptions): HTMLElement => {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'flex';
  wrapper.style.alignItems = 'center';
  wrapper.setAttribute('role', 'img');
  wrapper.setAttribute('aria-label', options.name ?? markerName(options));
  const dot = document.createElement('span');
  dot.className = `tl-marker tl-marker--${options.state}`;
  wrapper.append(dot);
  const chip =
    options.state === 'stale' && options.lastSeen
      ? options.lastSeen
      : options.state === 'sos' && options.showChip !== false
        ? `SOS · ${options.label.split(',')[0]}`
        : options.state === 'unheard' && options.showChip !== false
          ? MARKER_LABEL.unheard
          : null;
  if (chip) {
    const text = document.createElement('span');
    text.className = 'tl-marker-label';
    text.setAttribute('aria-hidden', 'true');
    if (options.state === 'sos') text.style.background = '#d0151d';
    text.textContent = chip;
    wrapper.append(text);
  }
  return wrapper;
};

/** A Leaflet icon for a device marker. The anchor is the centre of the dot, or the point of a pin. */
export const markerIcon = (options: MarkerOptions): L.DivIcon =>
  L.divIcon({
    html: markerElement(options),
    className: '',
    iconSize: options.state === 'sos' ? [20, 20] : [16, 16],
    // The pin is a 16 px square turned 45 degrees, so its point lies 8 * sqrt(2) below the centre.
    iconAnchor: options.state === 'sos' ? [10, 10] : options.state === 'unheard' ? [8, 19] : [8, 8],
  });
