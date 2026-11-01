import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { expectToast, publishSos, signIn, statusBadge } from './support/session';

// The Operator screens of MF-03 and MF-04 at 360 x 740 (project `operator-360`, REQ-UBI-03, NFR-UI-01): no
// horizontal scroll, and each screen's primary action is on screen without scrolling sideways.
//
// The incident screens need an open SOS of their own, so this spec publishes one SOS from TL-0009
// (RC-2026-0001, routed to the seeded Operator) and resolves it at the end; MF-03 uses TL-0010. The
// broker in MQTT_BROKER_URL and the backend ingestion must be running.

test.describe.configure({ mode: 'serial' });

const WIDTH = 360;

const expectNoHorizontalScroll = async (page: Page, screen: string) => {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return { scroll: root.scrollWidth, client: root.clientWidth, body: document.body.scrollWidth };
  });
  expect(overflow.scroll, `${screen}: page wider than the viewport`).toBeLessThanOrEqual(overflow.client);
  expect(overflow.body, `${screen}: body wider than the viewport`).toBeLessThanOrEqual(WIDTH);
};

const expectOnScreen = async (locator: Locator, what: string) => {
  await expect(locator, what).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, what).not.toBeNull();
  expect(box!.x, `${what}: starts left of the screen`).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, `${what}: ends right of the screen`).toBeLessThanOrEqual(WIDTH + 0.5);
};

const tab = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });

test('360 px: Live map (MF-04 steps 1 and 2, MF-02 step 3)', async ({ page }) => {
  await signIn(page, 'operator');
  await expect(page).toHaveURL(/\/o\/map$/);
  await expect(page.getByText(/^\d+ devices?, \d+ SOS open$/)).toBeVisible();
  await expect(page.getByText(/^\d+ live, \d+ offline, \d+ not heard since handover$/)).toBeVisible();
  await expectNoHorizontalScroll(page, 'Live map');
  const search = page.getByPlaceholder('Search asset tag, holder or contract');
  await expectOnScreen(search, 'device search');
  await search.fill('TL-0010');
  // The device list, not the map marker, which carries the same name once TL-0010 had an SOS.
  const list = page.getByLabel('Devices', { exact: true });
  await expectOnScreen(list.getByRole('button', { name: /^TL-0010 .*Pham Van F / }), 'TL-0010 row');
  await expectOnScreen(tab(page, 'Incidents'), 'Incidents tab');
  await expectNoHorizontalScroll(page, 'Live map, searched');
});

test('360 px: SOS banner, Incidents and the incident page (MF-03 steps 2 to 6)', async ({ page }) => {
  await signIn(page, 'operator');
  await publishSos('!de000009');

  // Step 2: the banner and its Acknowledge stay on screen.
  const banner = page.getByRole('alert').filter({ hasText: /SOS: TL-0009/ });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expectOnScreen(banner.getByRole('button', { name: 'Acknowledge' }), 'banner Acknowledge');
  await expectNoHorizontalScroll(page, 'Live map with the SOS banner');

  // Step 3: the incident list.
  await tab(page, 'Incidents').click();
  await expect(page).toHaveURL(/\/o\/incidents$/);
  await expectNoHorizontalScroll(page, 'Incidents');
  // At this width the list is a card per incident; the table is hidden.
  const card = page.locator('li, tr').filter({ hasText: 'TL-0009' }).filter({ visible: true }).first();
  const link = card.getByRole('link', { name: /^INC-\d{4}-\d{6}$/ });
  await expectOnScreen(link, 'incident link');
  await link.click();

  // Steps 4 to 6 on the incident page.
  const main = page.getByRole('main');
  await expect(main.getByText('TL-0009').first()).toBeVisible();
  await expectNoHorizontalScroll(page, 'Incident page');
  const acknowledge = main.getByRole('button', { name: 'Acknowledge', exact: true });
  await expectOnScreen(acknowledge, 'incident Acknowledge');
  await acknowledge.click();
  await expectToast(page, 'Saved.');
  await expect(banner).toHaveCount(0);

  const respond = main.getByRole('button', { name: 'Response under way' });
  await expectOnScreen(respond, 'Response under way');
  await respond.click();
  await main.getByRole('textbox', { name: /^What is being done/ }).fill('Ranger on the way');
  await expectOnScreen(main.getByRole('button', { name: 'Save response' }), 'Save response');
  await main.getByRole('button', { name: 'Save response' }).click();
  await expect(statusBadge(main, 'Responding')).toBeVisible();

  const outcome = main.getByRole('button', { name: 'Report outcome' });
  await expectOnScreen(outcome, 'Report outcome');
  await outcome.click();
  await main.getByRole('textbox', { name: /^Outcome/ }).fill('Hiker safe, 360 px check');
  await expectOnScreen(main.getByRole('button', { name: 'Resolve incident' }), 'Resolve incident');
  await main.getByRole('button', { name: 'Resolve incident' }).click();
  await expect(statusBadge(main, 'Resolved')).toBeVisible();
  await expectNoHorizontalScroll(page, 'Incident page, resolved');
});
