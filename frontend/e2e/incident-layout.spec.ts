import AxeBuilder from '@axe-core/playwright';
import { expect, test } from './support/fixtures';
import { apiGet, apiToken, goInApp, signIn } from './support/session';

// Screens 8.1/8.2, TK-211: real local API records at the leader's three review widths.
// Run after mf-03-sos-incident on the disposable demo seed so the organization has an incident.
// Reads records and never submits an incident action.
for (const role of ['operator', 'staff'] as const) {
  for (const width of [1440, 900, 360]) {
    for (const theme of ['light', 'dark'] as const) {
      test(`${role} incidents at ${width}px in ${theme}`, async ({ page, request }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.addInitScript((value) => localStorage.setItem('treklink.theme', value), theme);
        const token = await apiToken(request, role);
        const incidents = await apiGet<{ items: { id: string; code: string }[] }>(
          request, token, '/incidents?pageSize=50',
        );
        expect(incidents.items.length, 'the local seed must contain incident evidence').toBeGreaterThan(0);
        const incident = incidents.items[0];
        const queue = role === 'staff' ? '/t/incidents' : '/o/incidents';
        await signIn(page, role, queue);
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
        await expect(page.getByRole('main').getByText(incident.code, { exact: true }).first()).toBeVisible();
        const audit = async (screen: string) => {
          expect(await page.locator('html').evaluate((element) => element.scrollWidth), screen).toBeLessThanOrEqual(width);
          const result = await new AxeBuilder({ page }).include('main')
            .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
          await testInfo.attach(screen + '-axe', { body: JSON.stringify(result.violations), contentType: 'application/json' });
          expect(result.violations, screen).toEqual([]);
          const screenshot = testInfo.outputPath(screen + '.png');
          await page.screenshot({ path: screenshot });
          await testInfo.attach(screen, { path: screenshot, contentType: 'image/png' });
        };
        await audit('queue');
        await goInApp(page, queue + '/' + incident.id);
        await expect(page.getByRole('heading', { name: incident.code, exact: true })).toBeVisible();
        await expect(page.getByRole('heading', { name: /^Episode evidence/ })).toBeVisible();
        await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
        // Delivery records are restricted to Staff and organization managers, not Operators.
        const deliveries = page.getByRole('heading', { name: 'Alert deliveries', exact: true });
        if (role === 'staff') await expect(deliveries).toBeVisible();
        else await expect(deliveries).toHaveCount(0);
        await audit('detail');
        await page.keyboard.press('Tab');
        expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
      });
    }
  }
}
