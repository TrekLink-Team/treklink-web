import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Links in a map popup (WCAG 1.4.3; staging walk of 2026-11-06). jsdom does not load stylesheets, so this
// reads index.css, like markerTarget.test.ts. It pins the rule, it does not measure the colour: the
// contrast was computed from the tokens (8.9 to 1 dark, 5.86 to 1 light) and is to be measured on staging.
const css = readFileSync(fileURLToPath(new URL('./index.css', import.meta.url)), 'utf8');
const tokens = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

const SELECTOR = '.leaflet-container .leaflet-popup-content a';

describe('map popup links (index.css)', () => {
  it('colours them with the brand token, in a rule that outranks Leaflet .leaflet-container a', () => {
    const at = css.indexOf(`${SELECTOR} {`);
    expect(at).toBeGreaterThanOrEqual(0);
    const rule = css.slice(at, css.indexOf('}', at));
    expect(rule).toContain('color: rgb(var(--tl-brand));');
    // Leaflet's rule is `.leaflet-container a`: one class and one element. This one has two classes.
    const classes = SELECTOR.split(/\s+/).filter((part) => part.startsWith('.')).length;
    expect(classes).toBeGreaterThanOrEqual(2);
  });

  it('has a brand token in both themes for the rule to read', () => {
    expect(tokens.match(/--tl-brand:/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
