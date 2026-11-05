import L from 'leaflet';
import { MARKER_LABEL, type MarkerState } from '../status';

// Live device markers of the TrekLink System (DS-12, convention 06 §4 Pattern B). Shape carries the
// state as well as colour: a circle when live, a dashed circle when offline (with the last-seen time
// beside it), a pin with the chip "Not heard since handover" for a unit not heard since its handover
// (D-092 rule 2), a double-bordered pin with "Docked at the counter" for a unit the Staff browser holds
// (devices design section 12.8), a pulsing diamond for SOS. Markers keep their colours in both themes because the
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
        : (options.state === 'unheard' || options.state === 'docked') && options.showChip !== false
          ? MARKER_LABEL[options.state]
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

/** Smallest pointer target of a marker, in CSS px (WCAG 2.2, 2.5.8 Target Size Minimum). */
export const MARKER_TARGET_PX = 24;

// The drawn size of each dot; the target around it is MARKER_TARGET_PX whatever the dot.
const dotPx = (state: MarkerState): number => (state === 'sos' ? 20 : 16);
// The pin is a 16 px square turned 45 degrees, so its point lies 8 * sqrt(2), about 11 px, below its
// centre.
const PIN_POINT_PX = 11;

/**
 * A Leaflet icon for a device marker: a 24 px box (class `tl-marker-hit`) centred on the dot, which keeps
 * its drawn size. The pointer target is the 24 px circle `tl-marker-target` inside it, clipped with
 * `clip-path` because Chromium does not hit-test a `border-radius` circle exactly (review of
 * treklink-web#362). The clip sits on the target alone, so the chip, the SOS diamond and its pulse, and
 * the focus ring of the box are drawn whole. The anchor is the centre of the dot, or the point of a pin,
 * so the target of a pin sits on its head.
 */
export const markerIcon = (options: MarkerOptions): L.DivIcon => {
  const element = markerElement(options);
  // The dot is the first child, so its centre lands on the centre of the hit area; a chip runs to the
  // right of it. Nothing inside takes pointer events (index.css), so the target stays the circle.
  element.style.position = 'absolute';
  element.style.left = `${(MARKER_TARGET_PX - dotPx(options.state)) / 2}px`;
  element.style.top = '50%';
  element.style.transform = 'translateY(-50%)';
  // Wider than the hit area when a chip shows; without this the row would shrink the dot to fit 24 px.
  element.style.width = 'max-content';
  // Leaflet takes one element as the icon's content: the target, then the drawn marker over it.
  const target = document.createElement('span');
  target.className = 'tl-marker-target';
  target.setAttribute('aria-hidden', 'true');
  const body = document.createElement('div');
  body.className = 'tl-marker-body';
  body.append(target, element);
  const centre = MARKER_TARGET_PX / 2;
  return L.divIcon({
    html: body,
    className: 'tl-marker-hit',
    iconSize: [MARKER_TARGET_PX, MARKER_TARGET_PX],
    // The docked pin (devices design section 12.8) is drawn as the unheard pin, so it shares its anchor.
    iconAnchor: [
      centre,
      options.state === 'unheard' || options.state === 'docked' ? centre + PIN_POINT_PX : centre,
    ],
  });
};
