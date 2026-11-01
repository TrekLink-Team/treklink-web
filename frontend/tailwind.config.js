/**
 * TrekLink System for Tailwind CSS 3.4 (docs/design-system.md).
 *
 * Colours come from CSS variables in src/app/styles/tokens.css, so one class works in both themes:
 * `bg-surface text-ink` is near-white with dark text in Canopy (light) and the reverse in Volt
 * (dark). The theme is the `data-theme` attribute on <html>, set by shared/lib/theme.ts.
 *
 * New code uses the semantic names (ground, surface, chrome, ink, line, brand, accent, spark,
 * status-*). The legacy names further down (slate, white, blue, emerald, red, rose, amber,
 * indigo) exist only so pages written before the system follow the theme; do not use them in new
 * code (convention 15 §4).
 */

/** @param {string} name */
const v = (name) => `rgb(var(--tl-${name}) / <alpha-value>)`;

/** @param {string} family @param {(string|number)[]} shades */
const legacy = (family, shades) =>
  Object.fromEntries(shades.map((shade) => [shade, v(`legacy-${family}-${shade}`)]));

/** @param {string} name */
const status = (name) => ({
  tint: v(`status-${name}-tint`),
  fg: v(`status-${name}-fg`),
  line: v(`status-${name}-line`),
  strong: v(`status-${name}-strong`),
  on: v(`status-${name}-on-strong`),
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // 60 %: the neutral ground and solid data surfaces.
        ground: v('ground'),
        surface: { DEFAULT: v('surface'), raised: v('surface-raised') },
        sunken: v('sunken'),
        // 30 %: green-tinted chrome (header, sidebars, toolbar, selected rows).
        chrome: { DEFAULT: v('chrome'), strong: v('chrome-strong') },
        ink: { DEFAULT: v('ink'), muted: v('ink-muted'), inverse: v('ink-inverse') },
        inverse: v('inverse'),
        line: { DEFAULT: v('line'), strong: v('line-strong') },
        // 10 %: brand text, the primary fill, the highlight chip and the focus ring.
        brand: v('brand'),
        accent: { DEFAULT: v('accent'), hover: v('accent-hover'), pressed: v('accent-pressed') },
        'on-accent': v('on-accent'),
        spark: v('spark'),
        'on-spark': v('on-spark'),
        focus: v('focus'),
        glow: { DEFAULT: v('glow'), 2: v('glow-2') },
        scrim: v('scrim'),
        // TrekLink System Colors: status tones, kept apart from the brand green (D-06, D-12).
        status: {
          critical: status('critical'),
          attention: status('attention'),
          active: status('active'),
          waiting: status('waiting'),
          done: status('done'),
          ended: status('ended'),
        },
        // Map markers sit on light topographic tiles in both themes, so they do not switch.
        marker: {
          fresh: '#2f63e0',
          attention: '#b86e00',
          stale: v('marker-offline'),
          unheard: v('marker-unheard'),
          sos: '#d0151d',
        },

        // Legacy compatibility layer (deprecated).
        white: v('legacy-white'),
        slate: legacy('slate', [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]),
        blue: legacy('blue', [50, 100, 200, 300, 500, 700, 800, 900]),
        emerald: legacy('emerald', [50, 200, 300, 400, 500, 600, 700, 800]),
        red: legacy('red', [50, 200, 300, 600, 700, 800]),
        rose: legacy('rose', [50, 600]),
        amber: legacy('amber', [50, 100, 200, 300, 600, 900]),
        indigo: legacy('indigo', [50, 600]),
      },
      fontFamily: {
        sans: ['"Inter Variable"', 'Inter', 'system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
        display: ['"Plus Jakarta Sans Variable"', '"Plus Jakarta Sans"', '"Inter Variable"', 'system-ui', 'sans-serif'],
        mono: ['"Geist Mono Variable"', '"Geist Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      // Semantic type scale. Tailwind's text-xs to text-2xl stay available for existing pages.
      fontSize: {
        caption: ['0.75rem', { lineHeight: '1rem' }],
        'body-sm': ['0.8125rem', { lineHeight: '1.25rem' }],
        body: ['0.875rem', { lineHeight: '1.375rem' }],
        'body-lg': ['1rem', { lineHeight: '1.5rem' }],
        'title-sm': ['1.125rem', { lineHeight: '1.5rem', fontWeight: '700' }],
        title: ['1.375rem', { lineHeight: '1.75rem', fontWeight: '800', letterSpacing: '-0.01em' }],
        'title-lg': ['1.625rem', { lineHeight: '2rem', fontWeight: '800', letterSpacing: '-0.02em' }],
        display: ['2rem', { lineHeight: '2.5rem', fontWeight: '800', letterSpacing: '-0.02em' }],
        kpi: ['1.75rem', { lineHeight: '2.125rem', fontWeight: '800', letterSpacing: '-0.02em' }],
        label: ['0.6875rem', { lineHeight: '1rem', fontWeight: '800', letterSpacing: '0.12em' }],
      },
      borderRadius: {
        badge: '0.375rem',
        control: '0.5625rem',
        card: '0.75rem',
        panel: '0.875rem',
        sheet: '1.125rem',
      },
      boxShadow: {
        glass: 'var(--tl-shadow-glass)',
        raise: 'var(--tl-shadow-raise)',
        press: 'var(--tl-shadow-press)',
        overlay: 'var(--tl-shadow-overlay)',
        sheet: 'var(--tl-shadow-sheet)',
      },
      // Stacking layers (convention 06 §8.9: the incident banner outranks everything).
      zIndex: {
        map: '0',
        raised: '10',
        sidebar: '30',
        header: '40',
        drawer: '50',
        dialog: '60',
        toast: '70',
        banner: '80',
      },
      spacing: {
        header: '3.5rem',
        nav: '14.5rem',
        rail: '4rem',
        info: '21.25rem',
        tabbar: '4rem',
        toolbar: '3.25rem',
      },
      maxWidth: { measure: '62ch', page: '90rem' },
      ringColor: { DEFAULT: v('focus') },
      ringOffsetColor: { DEFAULT: v('surface') },
      transitionTimingFunction: { tl: 'cubic-bezier(0.2, 0.7, 0.3, 1)' },
      transitionDuration: { tl: '200ms' },
    },
  },
  plugins: [],
};
