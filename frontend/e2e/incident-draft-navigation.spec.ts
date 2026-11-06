import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fixtures';
import { signIn } from './support/session';

const id = '00000000-0000-4000-8000-000000000101';
const path = '/t/incidents/' + id;
const incident = {
  id,
  code: 'INC-2026-000001',
  state: 'UNROUTED',
  source: 'DEVICE_SOS',
  confidence: 'CONFIRMED',
  simulated: true,
  device: { id: 'device-1', assetTag: 'TL-0001', holder: null },
  organizationId: null,
  contractId: null,
  firstEventAt: '2026-11-06T02:00:00Z',
  lastEventAt: '2026-11-06T02:00:00Z',
  stateChangedAt: '2026-11-06T02:00:00Z',
  lastPosition: null,
  eventCount: 1,
  reopenCount: 0,
  version: 1,
  owner: null,
  stale: false,
  statusUpdates: [],
  authorityReports: [],
};

test('Staff incident drafts survive canceled browser and in-app navigation at 360 px', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  const user = {
    id: 'staff-1',
    email: 'staff@example.test',
    fullName: 'Test Staff',
    accountType: 'TREKLINK',
    roles: ['STAFF'],
    organization: null,
  };
  const tokens = {
    accessToken: 'fixture-access',
    accessTokenExpiresIn: 900,
    refreshToken: 'fixture-refresh',
    refreshTokenExpiresIn: 1209600,
  };
  await page.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    const endpoint = new URL(route.request().url()).pathname.replace(/^\/api/, '');
    const method = route.request().method();
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const fixtures: Record<string, unknown> = {
      '/auth/login': { user, ...tokens },
      '/auth/me': user,
      '/demo/accounts': { enabled: false, accounts: [] },
      '/incidents': { items: [incident], pageNumber: 1, pageSize: 20, totalCount: 1, totalPages: 1 },
      ['/incidents/' + id]: incident,
      ['/incidents/' + id + '/events']: [
        { eventId: 'e1', kind: 'SOS', observedAt: incident.firstEventAt, latitude: null, longitude: null },
      ],
      ['/incidents/' + id + '/transitions']: [],
      ['/incidents/' + id + '/alerts']: [],
    };
    const result = fixtures[endpoint];
    const statusCode = result === undefined ? 404 : 200;
    await route.fulfill({
      status: statusCode,
      headers,
      json: { result: result ?? null, isSuccess: statusCode === 200, statusCode, message: 'Fixture' },
    });
  });
  await signIn(page, { email: user.email, password: 'fixture-only' }, '/t/incidents');
  await page.getByRole('button', { name: incident.code, exact: true }).click();
  await page.getByRole('link', { name: 'Open incident page' }).click();
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await expect(page.getByRole('heading', { name: 'Episode evidence (1 event)' })).toBeVisible();
  expect(await page.locator('html').evaluate((element) => element.scrollWidth)).toBe(360);
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
  const detailAudit = await new AxeBuilder({ page }).include('main').withTags(tags).analyze();
  expect(detailAudit.violations).toEqual([]);

  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Declare false alarm', exact: true }).click();
  const draft = page.getByRole('textbox', { name: /Reason/ });
  await draft.fill('Keep this rehearsal draft');
  await page.goBack();
  const prompt = page.getByRole('dialog', { name: 'Discard unsaved changes?' });
  await expect(prompt.getByRole('button', { name: 'Keep editing' })).toBeFocused();
  await prompt.getByRole('button', { name: 'Keep editing' }).press('Escape');
  await expect(page).toHaveURL(new RegExp(path + '$'));
  await expect(draft).toHaveValue('Keep this rehearsal draft');

  // Cancel the browser's native warning. The document and the draft must survive.
  const reloadWarning = page.waitForEvent('dialog');
  const reload = page.evaluate(() => window.location.reload());
  const dialog = await reloadWarning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(draft).toHaveValue('Keep this rehearsal draft');

  await page.goBack();
  const audit = await new AxeBuilder({ page })
    .include('[role="dialog"][aria-labelledby="unsaved-navigation"]')
    .withTags(tags)
    .analyze();
  expect(audit.violations).toEqual([]);
  await prompt.getByRole('button', { name: 'Discard and leave' }).click();
  await expect(page).toHaveURL(/\/t\/incidents$/);
  await expect(draft).toHaveCount(0);
});
