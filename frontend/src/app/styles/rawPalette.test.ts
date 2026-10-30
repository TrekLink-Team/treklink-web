import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Pages, widgets, features and entities colour with theme tokens only (docs/design-system.md §7).
// A raw Tailwind palette class such as `text-emerald-900` or `bg-amber-100` keeps one shade in both
// themes, or lands on a legacy remap that was never contrast-checked against its partner, so it
// turns unreadable in Volt (dry run defect 2, 2026-10-30). shared/ui is out of scope on purpose:
// its primitives define the token recipes, and the legacy layer in tailwind.config.js stays for
// them until it is removed.

const SRC = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED = ['pages', 'widgets', 'features', 'entities'];

const FAMILIES =
  'slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black';
const UTILITIES =
  'bg|text|border(?:-[trblxy])?|ring|ring-offset|outline|divide|from|via|to|fill|stroke|placeholder|decoration|caret|accent|shadow';
const RAW_PALETTE = new RegExp(`(?<![\\w-])(?:${UTILITIES})-(?:${FAMILIES})(?:-\\d{2,3})?(?![\\w-])`, 'g');

const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });

const findings = (path: string): string[] =>
  readFileSync(path, 'utf8')
    .split('\n')
    .flatMap((line, index) =>
      [...line.matchAll(RAW_PALETTE)].map((match) => `${relative(SRC, path)}:${index + 1} ${match[0]}`),
    );

describe('raw palette guard', () => {
  it('recognises palette classes and leaves theme tokens alone', () => {
    const sample =
      'border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-slate-50 bg-white/90 ring-blue-200 ' +
      'bg-surface text-ink border-line-strong text-status-done-fg bg-accent-hover ring-focus/40';
    expect(sample.match(RAW_PALETTE)).toEqual([
      'border-emerald-200',
      'bg-emerald-50',
      'text-emerald-900',
      'bg-slate-50',
      'bg-white',
      'ring-blue-200',
    ]);
  });

  it.each(SCANNED)('src/%s uses theme tokens, not raw palette classes', (folder) => {
    const files = sources(join(SRC, folder));
    expect(files.length).toBeGreaterThan(0);
    expect(files.flatMap(findings)).toEqual([]);
  });
});
