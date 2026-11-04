import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// The live map marker's pointer target (WCAG 2.2, 2.5.8; review of treklink-web#362). jsdom does not
// hit-test, so this reads the rules from index.css. The hit-testing itself was checked in Chromium:
// points up to 11.9 px from a centre resolve to their own marker with a neighbour 25 px away, points
// 12.5 px out resolve to the map, and a keyboard focus shows the whole 2 px outline.
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');

const ruleOf = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('live map marker target (index.css)', () => {
  it('clips the target to a 24 px circle and lets only the target take the pointer', () => {
    const target = ruleOf('.tl-marker-body > .tl-marker-target');
    expect(target).toContain('clip-path: circle(12px at 50% 50%);');
    expect(target).toContain('pointer-events: auto;');
    expect(ruleOf('.tl-marker-body > *')).toContain('pointer-events: none;');
    expect(ruleOf('.leaflet-marker-icon.leaflet-interactive.tl-marker-hit')).toContain(
      'pointer-events: none;',
    );
  });

  it('never clips the focusable box, so its focus ring shows whole', () => {
    for (const selector of [
      '.leaflet-marker-icon.leaflet-interactive.tl-marker-hit',
      '.tl-marker-body',
    ]) {
      const rule = ruleOf(selector);
      expect(rule, selector).not.toContain('clip-path');
      expect(rule, selector).not.toContain('overflow');
    }
  });
});
