import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';

// Playwright journeys of frontend task 10.1 (specs/frontend/design.md §6): the main flows MF-01a to
// MF-05 on the demo seed, axe-core on every route, and the Operator screens at 360 x 740.
// Prerequisites, variables and commands: e2e/README.md.

// The SEED_*_PASSWORD values and the backend URLs live in the repository root `.env` (demo script
// §1.1). Load it when present; a variable already set in the shell wins over the file.
const here = dirname(fileURLToPath(import.meta.url));
const envFile = process.env.E2E_ENV_FILE ?? resolve(here, '..', '.env');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
// Optional: a Chromium build other than the one this Playwright release downloads.
const executablePath = process.env.E2E_CHROMIUM_PATH || undefined;

const chromium = {
  ...devices['Desktop Chrome'],
  // The demo is presented in Vietnam; the screens print local times (demo script, smoke notes).
  timezoneId: 'Asia/Ho_Chi_Minh',
  launchOptions: { executablePath },
};

export default defineConfig({
  testDir: './e2e',
  // One demo database, one pass: the journeys run in file order and share the seeded records.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    actionTimeout: 15_000,
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: /operator-360\.spec\.ts/,
      use: { ...chromium, viewport: { width: 1280, height: 900 } },
    },
    {
      // The Operator screens of MF-03 and MF-04 on a phone (NFR-USE-03, NFR-USE-05).
      name: 'operator-360',
      testMatch: /operator-360\.spec\.ts/,
      use: { ...chromium, viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true },
    },
  ],
  // Off by default: the demo runs `npm run dev` itself (demo script §1.2). E2E_START_SERVER=true starts
  // the Vite dev server for the run; the backend must already be up.
  webServer:
    process.env.E2E_START_SERVER === 'true'
      ? {
          command: 'npm run dev',
          url: baseURL,
          reuseExistingServer: true,
          timeout: 120_000,
        }
      : undefined,
});
