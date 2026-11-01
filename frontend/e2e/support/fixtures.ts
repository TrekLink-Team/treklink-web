import { test as base, expect, type Page } from '@playwright/test';

// A transparent 1 x 1 PNG.
const TILE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// A map tile URL of any basemap host: `/{z}/{x}/{y}` with or without an extension (OpenTopoMap,
// Stadia, Esri's `/tile/{z}/{y}/{x}`).
const TILE_PATH = /\/\d+\/\d+\/\d+(@2x)?(\.(png|jpg|jpeg|webp))?$/;

// E2E_STUB_TILES=true answers basemap tile requests with a blank tile, for a machine whose network
// blocks the tile hosts (the demo smokes did the same). Without it the map shows its "The map is
// unavailable" panel over the tiles, and a click on a map control fails. Leave it off on the demo
// laptop, where the real tiles are part of what MF-04 step 3 checks.
export const stubTiles = async (page: Page, baseURL: string | undefined): Promise<void> => {
  if (process.env.E2E_STUB_TILES !== 'true') return;
  const appOrigin = new URL(baseURL ?? 'http://localhost:5173').origin;
  await page.route(
    (url) => url.origin !== appOrigin && TILE_PATH.test(url.pathname),
    (route) => route.fulfill({ status: 200, contentType: 'image/png', body: TILE }),
  );
};

// The fixture callback is named `provide`, not Playwright's usual `use`, so the React hooks lint rule
// does not read it as React's use().
export const test = base.extend({
  page: async ({ page, baseURL }, provide) => {
    await stubTiles(page, baseURL);
    await provide(page);
  },
});

export { expect };
