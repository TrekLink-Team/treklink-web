import { expect, test } from './support/fixtures';
import { apiBase, apiToken, signIn } from './support/session';

// WF-04, live telemetry (BM04 scenarios DS-04a and DS-04b; demo script §5, MF-04 steps 1 and 4).
//
// The field data simulator (FIELD_SIMULATOR_ENABLED) ingests one position batch per
// `gatewaySync.simulatorIntervalSeconds` (60 by default) for TL-0009 and TL-0010, timed at the start of the
// interval. This spec sets `monitoring.deviceStaleSeconds` to its minimum, 30 seconds, so a unit that
// reported at the start of an interval reads Offline for the second half of it, then live again when the
// next batch arrives. It restores the parameter afterwards. Files run in alphabetical order on one
// database, so this one runs after the MF journeys and a11y.
//
// DS-04a's "none of another organization's" half needs a second organization that holds a rented device.
// The demo seed has one, so that half stays open (test.fixme below) until a seed change adds it.

const STALE_KEY = 'monitoring.deviceStaleSeconds';
const FAST_STALE_SECONDS = 30;

const LAST_SEEN = /last seen\s+([^\n]*\d\d:\d\d)/i;

interface ParameterItem {
  key: string;
  value: unknown;
  version: number;
}

const readParameter = async (
  request: import('@playwright/test').APIRequestContext,
  token: string,
): Promise<ParameterItem> => {
  const response = await request.get(`${apiBase()}/parameters?ownerModule=monitoring&pageSize=100`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), 'list monitoring parameters').toBeTruthy();
  const body = (await response.json()) as { result: { items: ParameterItem[] } };
  const item = body.result.items.find((candidate) => candidate.key === STALE_KEY);
  if (!item) throw new Error(`${STALE_KEY} is not in the parameter list`);
  return item;
};

const writeParameter = async (
  request: import('@playwright/test').APIRequestContext,
  token: string,
  value: number,
  reason: string,
): Promise<void> => {
  const current = await readParameter(request, token);
  if (current.value === value) return;
  const response = await request.patch(`${apiBase()}/parameters/${encodeURIComponent(STALE_KEY)}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { value, expectedVersion: current.version, reason },
  });
  expect(response.ok(), `set ${STALE_KEY} to ${value}`).toBeTruthy();
};

test.describe.serial('WF-04 live telemetry', () => {
  let original: unknown;

  test.beforeAll(async ({ request }) => {
    const token = await apiToken(request, 'admin');
    original = (await readParameter(request, token)).value;
    await writeParameter(request, token, FAST_STALE_SECONDS, 'WF-04 e2e: shorten the stale limit');
  });

  test.afterAll(async ({ request }) => {
    const token = await apiToken(request, 'admin');
    if (typeof original === 'number') {
      await writeParameter(request, token, original, 'WF-04 e2e: restore the stale limit');
    }
  });

  test('DS-04a: the Operator sees a simulated unit report again without a reload', async ({ page }) => {
    test.setTimeout(240_000);
    await signIn(page, 'operator');
    await expect(page).toHaveURL(/\/o\/map$/);
    const row = page.getByLabel('Devices', { exact: true }).getByRole('button', { name: /^TL-0010 / });
    await expect(row).toBeVisible();

    const lastSeen = async (): Promise<string> => ((await row.innerText()).match(LAST_SEEN)?.[1] ?? '').trim();
    await expect.poll(lastSeen, { timeout: 60_000 }).not.toBe('');
    const first = await lastSeen();

    // No page.goto and no click: the same window sees the next batch arrive.
    await expect.poll(lastSeen, { timeout: 150_000, intervals: [2_000] }).not.toBe(first);
  });

  test('DS-04b: a unit silent past the stale limit reads Offline with its last seen, then live again', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    await signIn(page, 'operator');
    await expect(page).toHaveURL(/\/o\/map$/);
    const row = page.getByLabel('Devices', { exact: true }).getByRole('button', { name: /^TL-0010 / });
    await expect(row).toBeVisible();

    await expect(row).toContainText(/Offline, last seen/i, { timeout: 150_000 });
    const offlineSeen = ((await row.innerText()).match(LAST_SEEN)?.[1] ?? '').trim();
    expect(offlineSeen).not.toBe('');
    await expect(page.getByText(/^\d+ live, \d+ offline, \d+ not heard since handover$/)).toBeVisible();

    // The next batch clears it, and the last seen moves on.
    await expect(row).not.toContainText(/Offline/i, { timeout: 150_000 });
    expect(((await row.innerText()).match(LAST_SEEN)?.[1] ?? '').trim()).not.toBe(offlineSeen);
  });

  test('DS-04a: the organization API answers only for the key, with the organization\'s own devices', async ({
    request,
  }) => {
    const key = process.env.SEED_ORG_API_KEY;
    test.skip(!key, 'SEED_ORG_API_KEY is not set');
    const unauthenticated = await request.get(`${apiBase()}/telemetry/devices`);
    expect(unauthenticated.status()).toBe(401);

    const response = await request.get(`${apiBase()}/telemetry/devices`, { headers: { 'X-Api-Key': key ?? '' } });
    expect(response.status()).toBe(200);
    const body = (await response.json()) as { result: { devices: { assetTag: string }[] } };
    expect(body.result.devices.map((device) => device.assetTag)).toEqual(
      expect.arrayContaining(['TL-0009', 'TL-0010']),
    );
  });

  test.fixme(
    'DS-04a: none of another organization\'s devices appear for the Operator',
    // Needs a second organization that holds a rented device; the demo seed has only ORG-0001.
    async () => {},
  );
});
