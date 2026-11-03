// Packages src/shared/ui (the TrekLink System components) the way a published component library
// ships, so the design-sync converter can read it: an ESM bundle, a .d.ts tree and one compiled
// stylesheet. The frontend is an app with no dist/, so without this the converter would scan every
// page under src/. Output goes to .ds-pkg/ (gitignored). Run from frontend/:
//   node .design-sync/build-pkg.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const esbuild = require(resolve('.ds-sync/node_modules/esbuild'));
const OUT = resolve('.ds-pkg');
const BIN = resolve('../node_modules/.bin');

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 'dist'), { recursive: true });

// 1. JS: the barrel, dependencies left external so the converter bundles them from node_modules.
await esbuild.build({
  entryPoints: ['src/shared/ui/index.ts'],
  outfile: join(OUT, 'dist/index.js'),
  bundle: true,
  format: 'esm',
  jsx: 'automatic',
  packages: 'external',
  tsconfig: 'tsconfig.json',
  // shared/api/apiClient reads the API base URL from Vite's env; previews never call the API.
  define: { 'import.meta.env.VITE_API_BASE_URL': '""', 'import.meta.env': '{}' },
  logLevel: 'warning',
});

// 2. Types: declarations for shared/ui and whatever it imports.
const tsconfig = join(OUT, 'tsconfig.dts.json');
writeFileSync(tsconfig, JSON.stringify({
  extends: resolve('tsconfig.json'),
  compilerOptions: {
    noEmit: false, declaration: true, emitDeclarationOnly: true, noEmitOnError: false,
    rootDir: resolve('src'), outDir: join(OUT, 'types'), baseUrl: resolve('.'),
  },
  include: [resolve('src/shared/ui/**/*.ts'), resolve('src/shared/ui/**/*.tsx'), resolve('src/vite-env.d.ts')],
  exclude: [resolve('src/**/*.test.ts'), resolve('src/**/*.test.tsx')],
}));
try {
  execFileSync(join(BIN, 'tsc'), ['-p', tsconfig], { stdio: 'inherit' });
} catch {
  console.error('! tsc reported errors; declarations were still emitted');
}

// 3. CSS: the app's global stylesheet compiled by Tailwind with the repo config (content = all of
// src/, so every class the app uses ships), then bundled by esbuild so the @fontsource files are
// copied next to it with working url()s.
const indexCss = readFileSync('src/app/styles/index.css', 'utf8');
const fontImports = indexCss.match(/^@import '@fontsource[^;]+;$/gm) ?? [];
const twIn = join(OUT, 'tw-in.css');
writeFileSync(twIn, indexCss
  .replace(/^@import '@fontsource[^;]+;$/gm, '')
  .replace("@import './tokens.css';", `@import '${resolve('src/app/styles/tokens.css')}';`));
execFileSync(join(BIN, 'tailwindcss'), ['-c', 'tailwind.config.js', '-i', twIn, '-o', join(OUT, 'tw.css')], { stdio: 'inherit' });
const cssEntry = join(OUT, 'css-entry.css');
writeFileSync(cssEntry, [...fontImports, "@import './tw.css';"].join('\n') + '\n');
await esbuild.build({
  entryPoints: [cssEntry],
  outfile: join(OUT, 'dist/styles.css'),
  bundle: true,
  loader: { '.woff2': 'file', '.woff': 'file' },
  assetNames: 'fonts/[name]',
  nodePaths: [resolve('../node_modules')],
  logLevel: 'warning',
});

writeFileSync(join(OUT, 'package.json'), JSON.stringify({
  name: '@treklink/ui',
  version: '0.1.0',
  module: 'dist/index.js',
  types: 'types/shared/ui/index.d.ts',
}, null, 2));
console.error(`» packaged src/shared/ui -> ${OUT}`);
