import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

// The four accounts of the demo seed (backend/prisma/seed-demo.ts, demo script §1.4). Their passwords
// are read from the SEED_*_PASSWORD variables at run time; no password is written in this repository.
export const ACCOUNTS = {
  admin: { email: 'admin@treklink.local', passwordVar: 'SEED_ADMIN_PASSWORD' },
  staff: { email: 'staff@treklink.local', passwordVar: 'SEED_STAFF_PASSWORD' },
  manager: { email: 'manager@treklink.local', passwordVar: 'SEED_MANAGER_PASSWORD' },
  operator: { email: 'operator@treklink.local', passwordVar: 'SEED_OPERATOR_PASSWORD' },
} as const;

export type SeededRole = keyof typeof ACCOUNTS;

export const passwordOf = (role: SeededRole): string => {
  const name = ACCOUNTS[role].passwordVar;
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See frontend/e2e/README.md.`);
  return value;
};

// The backend the Vite dev server talks to (VITE_API_BASE_URL in the root .env).
export const apiBase = (): string =>
  (process.env.E2E_API_URL ?? process.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api').replace(
    /\/$/,
    '',
  );

// Signs in through the sign-in page (screen 2.1). The session is held in memory only
// (entities/session/model.ts), so a page.goto() after this signs the window out: move with the
// sidebar, links, or goInApp() below. `next` lands on that path instead of the role's landing page.
export const signIn = async (
  page: Page,
  credentials: SeededRole | { email: string; password: string },
  next?: string,
): Promise<void> => {
  const { email, password } =
    typeof credentials === 'string'
      ? { email: ACCOUNTS[credentials].email, password: passwordOf(credentials) }
      : credentials;
  await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
  await page.locator('#sign-in-email').fill(email);
  await page.locator('#sign-in-password').fill(password);
  await page.locator('button[type="submit"]').click();
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 30_000 });
};

// Client-side navigation without a reload, as a link click does: BrowserRouter follows popstate.
export const goInApp = async (page: Page, path: string): Promise<void> => {
  await page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
  }, path);
  await page.waitForURL((url) => url.pathname + url.search === path);
};

// A sidebar entry (SideNav, `nav[aria-label="Modules"]`).
export const openFromSidebar = async (page: Page, label: string): Promise<void> => {
  await page.getByRole('navigation', { name: 'Modules' }).getByRole('link', { name: label, exact: true }).click();
};

// The toast of shared/ui/toast.
export const expectToast = async (page: Page, text: string | RegExp): Promise<void> => {
  await expect(page.getByRole('status').filter({ hasText: text }).first()).toBeVisible();
};

// An access token for direct API reads (record ids for the a11y routes, preconditions). Never used
// to change data a journey asserts on screen.
export const apiToken = async (request: APIRequestContext, role: SeededRole): Promise<string> => {
  const response = await request.post(`${apiBase()}/auth/login`, {
    data: { email: ACCOUNTS[role].email, password: passwordOf(role) },
  });
  expect(response.ok(), `login of ${role}`).toBeTruthy();
  const body = (await response.json()) as { result: { accessToken: string } };
  return body.result.accessToken;
};

export const apiGet = async <T>(request: APIRequestContext, token: string, path: string): Promise<T> => {
  const response = await request.get(`${apiBase()}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.ok(), `GET ${path} answered ${response.status()}`).toBeTruthy();
  return ((await response.json()) as { result: T }).result;
};

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const run = promisify(execFile);

// Runs a backend npm script from the repository root, as the demo script's terminal steps do
// (`npm --prefix backend run replay:mqtt -- sos --now --new-ids`, `demo:term-end`).
export const runBackendScript = async (script: string, args: string[]): Promise<string> => {
  const { stdout, stderr } = await run('npm', ['--prefix', 'backend', 'run', script, '--', ...args], {
    cwd: repositoryRoot,
    env: process.env,
    timeout: 90_000,
  });
  return `${stdout}\n${stderr}`;
};

// Numbers as the screens format them (en-US grouping, "1,125,000 VND").
export const vnd = (amount: number): string => `${amount.toLocaleString('en-US')} VND`;

// The value of a `<dt>`/`<dd>` pair, such as the Balance card's "Due now".
export const definitionOf = (scope: Page | Locator, term: string): Locator =>
  scope.locator('dt', { hasText: new RegExp(`^${term}$`) }).first().locator('xpath=following-sibling::dd[1]');

// True when the locator appears within the time, for a step that skips on a seed that lacks its
// record. count() alone answers before the page has loaded its data.
export const appears = async (locator: Locator, timeout = 10_000): Promise<boolean> =>
  locator
    .first()
    .waitFor({ state: 'attached', timeout })
    .then(() => true)
    .catch(() => false);

// Publishes one SOS text packet from a seeded node on its uplink topic, the shape of the fixture
// `backend/test/fixtures/mqtt/sos.json` and of the fallback SOS in demo script §8. It runs with the
// backend's own `mqtt` client (a backend dependency), from the backend folder.
export const publishSos = async (nodeId: string): Promise<void> => {
  const from = Number.parseInt(nodeId.replace('!', ''), 16);
  const now = Math.floor(Date.now() / 1000);
  const packet = {
    id: Math.floor(Math.random() * 0xffffffff),
    timestamp: now,
    to: 4294967295,
    from,
    channel: 0,
    type: 'text',
    sender: nodeId,
    payload: { text: 'SOS - [11.561000], [108.552000]' },
  };
  const script = `
    const { connectAsync } = require('mqtt');
    (async () => {
      const client = await connectAsync(process.env.MQTT_BROKER_URL || 'mqtt://localhost:1883', {
        username: process.env.MQTT_USERNAME, password: process.env.MQTT_PASSWORD });
      await client.publishAsync(process.argv[1], process.argv[2], { qos: 1 });
      await client.endAsync();
    })().catch((error) => { console.error(error.message); process.exit(1); });`;
  await run('node', ['-e', script, `treklink/2/json/LongFast/${nodeId}`, JSON.stringify(packet)], {
    cwd: resolve(repositoryRoot, 'backend'),
    env: process.env,
    timeout: 30_000,
  });
};
