import { expect, test } from './support/fixtures';
import { apiBase, openFromSidebar, signIn } from './support/session';

// MF-04, demo script §5: the Operator's live map, the sovereignty overlay and the basemaps, the Staff
// fleet map with its organization filter, the organization API, and the device history pages. The
// simulated gateway of MF-02 keeps reporting TL-0009 and TL-0010.

const HEADER = /^\d+ devices?, \d+ SOS open, \d+ stale/;

test('MF-04 steps 1 to 3: the Operator live map, search and the sovereignty overlay', async ({ page }) => {
  await signIn(page, 'operator');
  await expect(page).toHaveURL(/\/o\/map$/);
  await expect(page.getByText(HEADER)).toBeVisible();

  // Step 1: the units in ORG-0001's custody. TL-0017 and TL-0018 leave the map once MF-05 returns them.
  const list = page.getByLabel('Devices', { exact: true });
  for (const tag of ['TL-0009', 'TL-0010', 'TL-0019']) {
    await expect(list.getByRole('button', { name: new RegExp(`^${tag}, `) })).toBeVisible();
  }

  // Step 2
  await page.getByPlaceholder('Search asset tag, holder or contract').fill('TL-0010');
  await expect(list.getByRole('button')).toHaveCount(1);
  await expect(list.getByRole('button', { name: /^TL-0010, Pham Van F, / })).toBeVisible();

  // Step 3: the overlay labels are map markers the server lists (REQ-UBI-02, D-031); they are drawn at
  // every zoom. Zoom out as the presenter does, then read the credit and the three basemaps.
  await expect(page.getByText('Quần đảo Hoàng Sa (Việt Nam)')).toBeAttached();
  await expect(page.getByText('Quần đảo Trường Sa (Việt Nam)')).toBeAttached();
  const zoomOut = page.getByRole('button', { name: 'Zoom out' });
  for (let click = 0; click < 6; click += 1) await zoomOut.click();
  await expect(page.getByText('Quần đảo Hoàng Sa (Việt Nam)')).toBeVisible();
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Leaflet');
  await expect(page.locator('.leaflet-control-attribution')).toContainText('Tiles © Esri and the GIS user community');
  const layers = page.locator('.leaflet-control-layers');
  for (const name of ['Topographic (OpenTopoMap)', 'Terrain (Stadia)', 'Topographic (Esri)']) {
    await expect(layers.getByText(name)).toBeVisible();
  }
  await expect(layers.getByRole('radio', { name: 'Topographic (Esri)' })).toBeChecked();
  await layers.getByText('Terrain (Stadia)').click();
  await expect(layers.getByRole('radio', { name: 'Terrain (Stadia)' })).toBeChecked();
  await expect(page.getByText('Quần đảo Hoàng Sa (Việt Nam)')).toBeVisible();
});

test('MF-04 step 4: Staff filter the fleet map by organization', async ({ page }) => {
  await signIn(page, 'staff');
  await expect(page).toHaveURL(/\/t\/map$/);
  await expect(page.getByRole('heading', { name: 'Fleet map' }).first()).toBeAttached();
  const filter = page.locator('select#map-organization');
  await expect(filter).toHaveValue('');
  await expect(filter.locator('option:checked')).toHaveText('All organizations');
  const org = filter.locator('option', { hasText: 'ORG-0001' });
  await filter.selectOption((await org.getAttribute('value')) ?? '');
  await expect(page.getByLabel('Devices', { exact: true }).getByRole('button', { name: /^TL-0009, / })).toBeVisible();
});

test('MF-04 step 5: the organization API answers with the X-Api-Key', async ({ request }) => {
  const key = process.env.SEED_ORG_API_KEY;
  test.skip(!key, 'SEED_ORG_API_KEY is not set (optional in the demo script §1.1)');
  const response = await request.get(`${apiBase()}/telemetry/devices`, { headers: { 'X-Api-Key': key ?? '' } });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as {
    result: { cursor: unknown; devices: { assetTag: string }[] };
    isSuccess: boolean;
    statusCode: number;
    message: string;
  };
  expect(body).toMatchObject({ isSuccess: true, statusCode: 200 });
  expect(typeof body.message).toBe('string');
  expect(body.result.devices.map((device) => device.assetTag)).toEqual(
    expect.arrayContaining(['TL-0009', 'TL-0010']),
  );
});

test('MF-04 steps 6 and 7: Staff open the device history and the telemetry history', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Devices');
  await page.getByRole('link', { name: 'TL-0009', exact: true }).first().click();
  await expect(page).toHaveURL(/\/t\/devices\/[^/]+$/);

  // Step 6: the lifecycle, newest first (#225).
  const main = page.getByRole('main');
  for (const line of [
    'Handed over on RC-2026-0001 (ORG-0001)',
    'Provisioned with key version 1',
    'Reserved for RC-2026-0001 (ORG-0001)',
    'Intake check passed',
  ]) {
    await expect(main.getByText(line).first()).toBeVisible();
  }

  // Step 7
  await main.getByRole('link', { name: 'Position history' }).click();
  await expect(page.getByRole('heading', { name: 'Telemetry history' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Download CSV' })).toBeVisible();
});
