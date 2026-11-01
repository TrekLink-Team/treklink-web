import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// WCAG 2.2 AA for every pairing the TrekLink System allows (docs/design-system.md §3):
// 4.5:1 for text (1.4.3), 3:1 for control boundaries, focus rings and status marks (1.4.11, 2.4.11).
// The values are read from tokens.css itself, so a token edit that breaks a pairing fails here.

type Rgb = [number, number, number];
type Theme = Record<string, Rgb>;

const css = readFileSync(fileURLToPath(new URL('./tokens.css', import.meta.url)), 'utf8');

const parse = (block: string): Theme => {
  const theme: Theme = {};
  for (const match of block.matchAll(/--tl-([\w-]+): (\d+) (\d+) (\d+);/g)) {
    theme[match[1]] = [Number(match[2]), Number(match[3]), Number(match[4])];
  }
  return theme;
};

const [lightBlock, darkBlock] = css.split(":root[data-theme='dark']");
const THEMES: Record<'light' | 'dark', Theme> = {
  light: parse(lightBlock),
  dark: parse(darkBlock),
};

const channel = (value: number): number => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const luminance = ([r, g, b]: Rgb): number =>
  0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
const ratio = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const mix = (top: Rgb, bottom: Rgb, alpha: number): Rgb =>
  top.map((value, index) => Math.round(alpha * value + (1 - alpha) * bottom[index])) as Rgb;

const WHITE: Rgb = [255, 255, 255];
const STATUSES = ['critical', 'attention', 'active', 'waiting', 'done', 'ended'];

// The glass recipe of index.css: a glow on the ground, the surface at 72 % over it, then the sheen.
const glassBackdrops = (t: Theme, mode: 'light' | 'dark'): Rgb[] => {
  const glowAlpha = mode === 'light' ? 0.5 : 0.75;
  const sheen = mode === 'light' ? 0.55 : 0.06;
  const behind = [
    t.ground,
    mix(t.glow, t.ground, glowAlpha),
    mix(t['glow-2'], t.ground, glowAlpha),
  ];
  return behind.flatMap((under) => {
    const glass = mix(t.surface, under, 0.72);
    return [glass, mix(WHITE, glass, sheen)];
  });
};

describe.each(['light', 'dark'] as const)('%s theme', (mode) => {
  const t = THEMES[mode];
  const get = (name: string): Rgb => {
    const value = t[name];
    if (!value) throw new Error(`token --tl-${name} is missing in the ${mode} block`);
    return value;
  };

  it('defines every token in both themes', () => {
    expect(Object.keys(THEMES.light).sort()).toEqual(Object.keys(THEMES.dark).sort());
  });

  // Map markers sit on light tiles in both themes with a white border: a status mark needs 3:1.
  it.each(['marker-offline', 'marker-unheard'])(
    'keeps %s at 3:1 against its white border',
    (name) => {
      expect(ratio(get(name), WHITE)).toBeGreaterThanOrEqual(3);
    },
  );

  const text: [string, string][] = [];
  for (const bg of ['ground', 'surface', 'surface-raised', 'sunken', 'chrome']) {
    text.push(['ink', bg], ['ink-muted', bg]);
  }
  text.push(
    ['brand', 'ground'],
    ['brand', 'surface'],
    ['brand', 'chrome'],
    ['on-accent', 'accent'],
    ['on-accent', 'accent-hover'],
    ['on-accent', 'accent-pressed'],
    ['on-spark', 'spark'],
    ['ink-inverse', 'inverse'],
  );
  for (const s of STATUSES) {
    text.push(
      [`status-${s}-fg`, `status-${s}-tint`],
      [`status-${s}-fg`, 'surface'],
      [`status-${s}-fg`, 'ground'],
      [`status-${s}-on-strong`, `status-${s}-strong`],
    );
  }

  it.each(text)('text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(ratio(get(fg), get(bg))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps body and muted text at 4.5:1 on glass over the brightest glow', () => {
    for (const backdrop of glassBackdrops(t, mode)) {
      expect(ratio(get('ink'), backdrop)).toBeGreaterThanOrEqual(4.5);
      expect(ratio(get('ink-muted'), backdrop)).toBeGreaterThanOrEqual(4.5);
    }
  });

  const marks: [string, string][] = [
    ['line-strong', 'surface'],
    ['line-strong', 'ground'],
    ['focus', 'ground'],
    ['focus', 'surface'],
    ['focus', 'chrome'],
    ['accent', 'surface'],
  ];
  for (const s of STATUSES) {
    marks.push([`status-${s}-line`, 'surface'], [`status-${s}-strong`, 'surface']);
  }

  it.each(marks)('mark %s against %s reaches 3:1', (fg, bg) => {
    expect(ratio(get(fg), get(bg))).toBeGreaterThanOrEqual(3);
  });

  // Pages written before the system use these Tailwind names (tailwind.config.js, legacy layer).
  const legacyText: [string, string][] = [
    ['slate-500', 'white'],
    ['slate-600', 'white'],
    ['slate-600', 'slate-50'],
    ['slate-700', 'white'],
    ['slate-700', 'slate-100'],
    ['slate-800', 'white'],
    ['slate-900', 'white'],
    ['slate-900', 'slate-50'],
    ['white', 'slate-900'],
    ['blue-700', 'white'],
    ['white', 'blue-700'],
    ['white', 'blue-800'],
    ['blue-800', 'blue-50'],
    ['blue-900', 'blue-50'],
    ['emerald-700', 'white'],
    ['emerald-800', 'emerald-50'],
    ['emerald-600', 'emerald-50'],
    ['red-700', 'white'],
    ['red-800', 'red-50'],
    ['white', 'red-600'],
    ['amber-900', 'amber-50'],
    ['amber-900', 'amber-100'],
    ['amber-600', 'amber-50'],
    ['rose-600', 'rose-50'],
    ['indigo-600', 'indigo-50'],
  ];

  it.each(legacyText)('legacy text %s on %s reaches 4.5:1', (fg, bg) => {
    expect(ratio(get(`legacy-${fg}`), get(`legacy-${bg}`))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps legacy input borders at 3:1', () => {
    expect(ratio(get('legacy-slate-400'), get('legacy-white'))).toBeGreaterThanOrEqual(3);
  });
});

describe('status tones stay apart from the brand', () => {
  // Hue in degrees from sRGB, enough to check the green band rule of DS-06.
  const hue = ([r, g, b]: Rgb): number => {
    const [rr, gg, bb] = [r / 255, g / 255, b / 255];
    const max = Math.max(rr, gg, bb);
    const min = Math.min(rr, gg, bb);
    if (max === min) return 0;
    const d = max - min;
    const h = max === rr ? ((gg - bb) / d) % 6 : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
    return (h * 60 + 360) % 360;
  };

  it.each(['light', 'dark'] as const)(
    'no %s status colour sits in the brand green band',
    (mode) => {
      const t = THEMES[mode];
      for (const s of STATUSES.filter((name) => name !== 'ended')) {
        const h = hue(t[`status-${s}-fg`]);
        expect(h < 80 || h > 175, `${s} hue ${h.toFixed(0)}`).toBe(true);
      }
    },
  );
});
