// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMarkerGlider, easeOutCubic, REDUCED_MOTION_QUERY } from './glide';

// A frame queue the test advances by hand, with the timestamp each frame receives.
const frames = new Map<number, FrameRequestCallback>();
let nextFrame = 1;
const runFrame = (now: number) => {
  const pending = [...frames.values()];
  frames.clear();
  pending.forEach((callback) => callback(now));
};
const reducedMotion = (matches: boolean) =>
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({ matches: matches && query === REDUCED_MOTION_QUERY })),
  );

let map: L.Map;
const centre: [number, number] = [11.56, 108.54];

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(nextFrame, callback);
    return nextFrame++;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, value: 512 });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, value: 512 });
  map = L.map(document.createElement('div')).setView(centre, 12);
});

afterEach(() => {
  map.remove();
  frames.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth');
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight');
});

describe('createMarkerGlider', () => {
  it('eases out from 0 to 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('glides a short on-screen move over the duration and ends on the target', () => {
    const marker = L.marker(centre).addTo(map);
    const glider = createMarkerGlider(map);
    glider.moveTo(marker, [11.562, 108.542]);
    expect(marker.getLatLng().equals(L.latLng(centre))).toBe(true);
    runFrame(100);
    runFrame(600);
    const half = marker.getLatLng();
    expect(half.lat).toBeGreaterThan(11.56);
    expect(half.lat).toBeLessThan(11.562);
    runFrame(1100);
    expect(marker.getLatLng().equals(L.latLng(11.562, 108.542))).toBe(true);
    expect(frames.size).toBe(0);
  });

  it('keeps a glide in flight when the same target arrives again', () => {
    const marker = L.marker(centre).addTo(map);
    const glider = createMarkerGlider(map);
    glider.moveTo(marker, [11.562, 108.542]);
    runFrame(0);
    runFrame(500);
    glider.moveTo(marker, [11.562, 108.542]);
    runFrame(1000);
    expect(marker.getLatLng().equals(L.latLng(11.562, 108.542))).toBe(true);
  });

  it('jumps a move longer than the limit, off the view, or under reduced motion', () => {
    const marker = L.marker(centre).addTo(map);
    const glider = createMarkerGlider(map);
    glider.moveTo(marker, [11.61, 108.54]);
    expect(marker.getLatLng().lat).toBe(11.61);
    glider.moveTo(marker, centre);
    // At zoom 17 the view is about 600 m across: a 450 m move leaves it.
    map.setView(centre, 17);
    glider.moveTo(marker, [11.564, 108.54]);
    expect(marker.getLatLng().lat).toBe(11.564);
    map.setView(centre, 12);
    glider.moveTo(marker, centre);
    reducedMotion(true);
    glider.moveTo(marker, [11.562, 108.542]);
    expect(marker.getLatLng().lat).toBe(11.562);
    expect(frames.size).toBe(0);
  });

  it('does nothing for a marker already on the target', () => {
    const marker = L.marker(centre).addTo(map);
    const move = vi.spyOn(marker, 'setLatLng');
    createMarkerGlider(map).moveTo(marker, centre);
    expect(move).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('cancels one glide or all of them', () => {
    const a = L.marker(centre).addTo(map);
    const b = L.marker(centre).addTo(map);
    const glider = createMarkerGlider(map);
    glider.moveTo(a, [11.562, 108.542]);
    glider.moveTo(b, [11.558, 108.538]);
    glider.cancel(a);
    expect(frames.size).toBe(1);
    glider.cancel(a);
    glider.cancelAll();
    expect(frames.size).toBe(0);
  });
});
