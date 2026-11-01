import { expect, test } from './support/fixtures';
import { appears, openFromSidebar, signIn } from './support/session';

// MF-02, demo script §3: device data reaching the platform through the Field Station bridge, and the
// sync status page.
//
// Hardware: there is no LoRa radio in the run. The demo drives this flow with the gateway in
// simulation mode (GATEWAY_SERIAL_SIMULATION=true, `npm run dev` starts it), which publishes a position
// and a telemetry reading for TL-0009 and TL-0010 every 5 s through the real SQLite queue and MQTT
// path; this spec does the same and needs that gateway running against the broker in MQTT_BROKER_URL,
// with GATEWAY_FS_USERNAME=fs-org-0001-1 (script §1.1). Steps 1 and 2 are a terminal and a talking
// point. The optional step 6 (broker outage) stops and starts the Docker broker and is not driven here.

test('MF-02 step 3: the Operator sees TL-0009 and TL-0010 reporting on the live map', async ({ page }) => {
  await signIn(page, 'operator');
  await expect(page).toHaveURL(/\/o\/map$/);
  const list = page.getByRole('region', { name: 'Devices' }).or(page.getByLabel('Devices'));
  for (const tag of ['TL-0009', 'TL-0010']) {
    const row = list.getByRole('button', { name: new RegExp(`^${tag} `) });
    await expect(row).toBeVisible();
    // A battery percentage from the simulator (100 % at the gateway's start, one less every 5 min).
    await expect(row).toContainText(/\d+%/);
  }
});

test('MF-02 steps 4 and 5: Staff read the Field data sync page', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Field data sync');
  await expect(page).toHaveURL(/\/t\/admin\/sync$/);
  await expect(page.getByRole('heading', { name: 'Field data sync' })).toBeVisible();

  for (const card of [
    'MQTT subscriber',
    'Accepted',
    'Duplicates rejected',
    'Malformed',
    'Normalization failed',
    'Unattributed',
    'Unknown device',
  ]) {
    await expect(page.getByText(card, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByText('UP', { exact: true }).first()).toBeVisible();

  // The seeded station reports through the simulated gateway.
  const station = page.getByRole('row').filter({ hasText: 'Ta Nang basecamp laptop' });
  await expect(station).toContainText('TrekLink Demo Tours Co., Ltd.');
  await expect(station).toContainText('Connected');
  await expect(station).toContainText('0, 0, 0, 0');
  // The station of MF-01 step 13, when that flow ran first.
  const created = page.getByRole('row').filter({ hasText: 'Phan Dung ranger post' }).first();
  if (await appears(created, 2_000)) await expect(created).toContainText('Never reported');

  await expect(page.getByRole('heading', { name: 'Recent field events' })).toBeVisible();
  const event = page.getByRole('row').filter({ hasText: 'TL-0009' }).filter({ hasText: 'Node uplink' }).first();
  await expect(event).toBeVisible();
  // Attribution reads Unattributed for the first 300 s after the seeded handover
  // (gatewaySync.attributionMarginSeconds), Attributed after.
  await expect(event).toContainText(/Attributed|Unattributed/);
  await expect(page.getByRole('heading', { name: 'Sync audit' })).toBeVisible();

  // Step 5: a narrower rolling window applies on selection; Refresh reads it again.
  const windowSelect = page.getByRole('combobox', { name: 'Window' });
  await windowSelect.selectOption('15');
  await expect(page.getByText('Last 15 min', { exact: true })).toBeVisible();
  const status = page.waitForResponse(
    (response) => response.url().endsWith('/api/gateway-sync') && (response.request().postData() ?? '').includes('syncStatus'),
  );
  await page.getByRole('button', { name: 'Refresh' }).click();
  expect((await status).ok()).toBeTruthy();
});
