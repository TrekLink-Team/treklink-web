/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const NODE_SHIM = '\0meshtastic-node-shim';
const RUNTIME_VERSION = 'runtimeVersion: process?.version,';

// `@meshtastic/core` 2.6.7 on npm bundles tslog's Node runtime: it imports `os`, `path` and `util` and
// reads `process?.version` when the module loads, which fails the browser build ("hostname" is not
// exported by the browser stub) and would throw in the browser. The docking adapter silences the
// logger, so these stubs are never called; they only let the module load (devices design section 8.1,
// vetting record meshtastic-web-serial.md). Scoped to that one package.
const meshtasticBrowserShim = (): Plugin => ({
  name: 'meshtastic-browser-shim',
  enforce: 'pre',
  resolveId(id, importer) {
    if (importer?.includes('/@meshtastic/core/') && ['os', 'path', 'util'].includes(id)) {
      return NODE_SHIM;
    }
    return null;
  },
  load(id) {
    if (id !== NODE_SHIM) return null;
    return [
      'export const hostname = undefined;',
      'export const normalize = (value) => value;',
      'export const formatWithOptions = (_options, ...args) => args.map(String).join(" ");',
      'export const types = undefined;',
    ].join('\n');
  },
  transform(code, id) {
    if (!id.includes('/@meshtastic/core/dist/mod.js')) return null;
    // A version bump that changes this line would reintroduce the browser crash silently, so the build
    // stops instead of shipping it.
    if (!code.includes(RUNTIME_VERSION)) {
      this.error(
        `meshtastic-browser-shim: "${RUNTIME_VERSION}" not found in @meshtastic/core; update the shim for this version.`,
      );
    }
    return { code: code.replace(RUNTIME_VERSION, 'runtimeVersion: undefined,'), map: null };
  },
});

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), meshtasticBrowserShim()],
  // Served through the plugin above in `vite dev` too, instead of the esbuild pre-bundle.
  optimizeDeps: {
    exclude: ['@meshtastic/core', '@meshtastic/transport-web-serial'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
  },
  // Vitest runs the unit and component tests under src/ only; the Playwright journeys in e2e/ run with
  // `npm run test:e2e` (e2e/README.md).
  test: {
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: ['e2e/**', 'node_modules/**', 'dist/**'],
  },
});
