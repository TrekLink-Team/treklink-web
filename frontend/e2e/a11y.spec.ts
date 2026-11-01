import AxeBuilder from '@axe-core/playwright';
import type { APIRequestContext, BrowserContext, Page } from '@playwright/test';
import { expect, stubTiles, test } from './support/fixtures';
import { apiGet, apiToken, goInApp, signIn, type SeededRole } from './support/session';

// axe-core on every route of frontend/src/app/router.tsx that a seeded role reaches (frontend task
// 10.1, NFR-USE-05): WCAG 2.0 and 2.1, levels A and AA. A violation of impact `serious` or `critical`
// fails its route unless ALLOWLIST below names the rule and the route with a reason. Every violation
// found, allowlisted or not, is attached to the route's result as `axe-violations` and printed.
//
// The session is held in memory only, so each role signs in once and moves between routes without a
// reload (goInApp). A detail route opens a record read from the API; when the seed holds none (a
// compliance case, a SePay payment), the route is checked in its not-found state and says so in an
// annotation.

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const BLOCKING = new Set(['serious', 'critical']);
const MISSING_ID = '00000000-0000-4000-8000-000000000000';

interface AllowEntry {
  rule: string;
  route: string;
  reason: string;
}

// Known violations, each with the rule, the route pattern as router.tsx writes it, and why it is not
// fixed in this branch (test work only). Remove an entry when its defect is fixed.
const ALLOWLIST: AllowEntry[] = [
  {
    rule: 'label-content-name-mismatch',
    route: '/o/map',
    reason: 'device row aria-label omits the visible battery percentage (LiveMapPage.tsx:132), WCAG 2.5.3',
  },
  {
    rule: 'label-content-name-mismatch',
    route: '/t/map',
    reason: 'same device row as /o/map (LiveMapPage.tsx:132)',
  },
  {
    rule: 'label-content-name-mismatch',
    route: '/t/admin/audit/sign-ins',
    reason: 'account filter link is named "Filter by the account of ..." around a visible email (AuthEventsPage.tsx:228)',
  },
];

type Resolve = (request: APIRequestContext, token: string) => Promise<string | null>;

interface RouteCase {
  pattern: string;
  resolve?: Resolve;
}

const firstId =
  (path: string, pick: (item: { id: string } & Record<string, unknown>) => boolean = () => true): Resolve =>
  async (request, token) => {
    const page = await apiGet<{ items: ({ id: string } & Record<string, unknown>)[] }>(request, token, path);
    return page.items.find(pick)?.id ?? null;
  };

const deviceId = (assetTag: string): Resolve => firstId(`/devices?q=${assetTag}&pageSize=50`, (d) => d.assetTag === assetTag);

const ROUTES: Record<SeededRole | 'anonymous', RouteCase[]> = {
  anonymous: [
    { pattern: '/' },
    { pattern: '/plans' },
    { pattern: '/sign-in' },
    { pattern: '/forgot' },
    { pattern: '/reset' },
    { pattern: '/welcome' },
    { pattern: '/register' },
    { pattern: '/dev/design-system' },
    { pattern: '/no-such-page' },
  ],
  operator: [
    { pattern: '/o/map' },
    { pattern: '/o/incidents' },
    { pattern: '/o/incidents/:id', resolve: firstId('/incidents?pageSize=20') },
    { pattern: '/o/contracts' },
    { pattern: '/o/contracts/:id', resolve: firstId('/contracts?pageSize=20') },
    { pattern: '/o/devices/:id/telemetry', resolve: async (request) => deviceId('TL-0009')(request, await apiToken(request, 'staff')) },
    { pattern: '/o/roster' },
    { pattern: '/o/field-stations' },
  ],
  manager: [
    { pattern: '/o' },
    { pattern: '/o/contracts/new' },
    { pattern: '/o/invoices' },
    { pattern: '/o/invoices/:id', resolve: firstId('/invoices?pageSize=20') },
    // A SePay payment exists only after Pay with SePay; the seed has none.
    { pattern: '/o/pay/:paymentId' },
    { pattern: '/o/api-keys' },
    { pattern: '/o/members' },
  ],
  staff: [
    { pattern: '/t/map' },
    { pattern: '/t/incidents' },
    { pattern: '/t/contracts' },
    { pattern: '/t/contracts/:id', resolve: firstId('/contracts?pageSize=50', (c) => c.code === 'RC-2026-0001') },
    { pattern: '/t/devices/:id/telemetry', resolve: deviceId('TL-0009') },
    { pattern: '/t/billing' },
    { pattern: '/t/damage-charges' },
    { pattern: '/t/organizations' },
    { pattern: '/t/counter/:contractId', resolve: firstId('/contracts?pageSize=50', (c) => c.code === 'RC-2026-0001') },
    { pattern: '/t/fleet' },
    { pattern: '/t/devices/:id', resolve: deviceId('TL-0009') },
    { pattern: '/t/maintenance' },
    { pattern: '/t/compliance-cases' },
    { pattern: '/t/compliance-cases/:id', resolve: firstId('/compliance-cases') },
    { pattern: '/t/admin/sync' },
  ],
  admin: [
    // Routed under Staff, but the page itself answers Admin only (MaintenancePage.tsx:1121).
    { pattern: '/t/maintenance/approvals' },
    { pattern: '/t/admin/accounts' },
    { pattern: '/t/admin/prices' },
    { pattern: '/t/admin/parameters' },
    { pattern: '/t/admin/audit' },
    { pattern: '/t/admin/audit/changes' },
    { pattern: '/t/admin/audit/sign-ins' },
    { pattern: '/t/admin/demo' },
  ],
};

// Waits until the page has had no request in flight for 500 ms (at most 10 s): the route's queries
// have answered and the page shows data, not its skeleton.
const settle = async (page: Page, inFlight: Set<unknown>) => {
  const deadline = Date.now() + 10_000;
  let quietSince = Date.now();
  while (Date.now() < deadline) {
    if (inFlight.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) break;
    await page.waitForTimeout(100);
  }
};

for (const [role, routes] of Object.entries(ROUTES) as [SeededRole | 'anonymous', RouteCase[]][]) {
  // Not serial: a failing route does not stop the next one. A failure restarts the worker, which runs
  // beforeAll again and signs in again.
  test.describe(`axe, ${role}`, () => {
    let context: BrowserContext;
    let page: Page;
    let token = '';
    const inFlight = new Set<unknown>();

    test.beforeAll(async ({ browser, baseURL, request }) => {
      // AxeBuilder needs a page of an explicit context.
      context = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', baseURL, viewport: { width: 1280, height: 900 } });
      page = await context.newPage();
      await stubTiles(page, baseURL);
      // A live socket is not an HTTP request; only fetch and XHR count as in flight.
      page.on('request', (r) => ['fetch', 'xhr'].includes(r.resourceType()) && inFlight.add(r));
      page.on('requestfinished', (r) => inFlight.delete(r));
      page.on('requestfailed', (r) => inFlight.delete(r));
      if (role === 'anonymous') {
        await page.goto('/');
      } else {
        await signIn(page, role);
        token = await apiToken(request, role);
      }
    });

    test.afterAll(async () => {
      await context?.close();
    });

    for (const route of routes) {
      test(`${route.pattern}`, async ({ request }, testInfo) => {
        let path = route.pattern;
        if (path.includes(':')) {
          const id = route.resolve ? await route.resolve(request, token) : null;
          if (!id) testInfo.annotations.push({ type: 'state', description: 'no record on this seed: checked in its not-found state' });
          path = path.replace(/:[A-Za-z]+/, id ?? MISSING_ID);
        }
        if (role === 'anonymous') await page.goto(path);
        else await goInApp(page, path);
        await settle(page, inFlight);
        // The route rendered for the signed-in role, not the sign-in page or the no-access notice.
        if (role !== 'anonymous') {
          expect(new URL(page.url()).pathname).not.toBe('/sign-in');
          await expect(page.getByRole('navigation', { name: 'Modules' })).toBeVisible();
          await expect(page.getByText('You do not have access to this.')).toHaveCount(0);
        }

        const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        const found = results.violations.map((violation) => ({
          rule: violation.id,
          impact: violation.impact ?? 'unknown',
          nodes: violation.nodes.length,
          help: violation.help,
          targets: violation.nodes.slice(0, 3).map((node) => node.target.join(' ')),
          allowed: ALLOWLIST.find((entry) => entry.rule === violation.id && entry.route === route.pattern)?.reason,
        }));
        await testInfo.attach('axe-violations', { body: JSON.stringify(found, null, 2), contentType: 'application/json' });
        for (const v of found) {
          console.log(`[axe] ${role} ${route.pattern} ${v.rule} ${v.impact} nodes=${v.nodes}${v.allowed ? ' (allowlisted)' : ''} ${v.targets.join(' | ')}`);
          if (v.allowed) testInfo.annotations.push({ type: 'axe-allowlisted', description: `${v.rule}: ${v.allowed}` });
        }
        const blocking = found.filter((v) => BLOCKING.has(v.impact) && !v.allowed);
        expect(blocking, `serious or critical axe violations on ${route.pattern}`).toEqual([]);
      });
    }
  });
}
