import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from './support/fixtures';
import { expectToast, openFromSidebar, signIn } from './support/session';

// MF-01a, demo script §2a: an organization registers, Staff verify it at the counter, an Admin approves
// it, and its Manager sets a password from the invitation code. One serial journey; each step names
// its row in the script.
//
// The script registers "Phan Dung Trekking Co., Ltd." with tax code 0312345678. A second registration
// with the same tax code or Manager email is refused (script §1.3), so this run makes both unique and
// reads the organization code from the screen instead of assuming ORG-0002.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString();
const org = {
  legalName: `Phan Dung Trekking Co., Ltd. ${stamp.slice(-5)}`,
  taxCode: `03${stamp.slice(-8)}`,
  address: '12 Nguyen Van Troi, Da Lat, Lam Dong',
  phone: '0263 3822 111',
  managerName: 'Tran Van Binh',
  managerEmail: `binh.manager.${stamp}@example.com`,
  managerPhone: '0903 111 222',
};
let orgCode = '';

// Step 6 reads the invitation code from the backend log (MAIL_TRANSPORT=console writes every email
// there). E2E_BACKEND_LOG names the file the `npm run dev` output is written to.
const invitationCodeFromLog = (email: string): string | null => {
  const path = process.env.E2E_BACKEND_LOG;
  if (!path || !existsSync(path)) return null;
  const lines = readFileSync(path, 'utf8').split('\n').filter((line) => line.includes(`to=${email}`));
  for (const line of lines.reverse()) {
    const match = /Your TrekLink invitation code is ([^.\s]+)\./.exec(line);
    if (match) return match[1];
  }
  return null;
};

test('MF-01a steps 1 and 2: register the organization', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Register your organization' }).first().click();
  await expect(page.getByRole('heading', { name: 'Register your organization' })).toBeVisible();

  await page.getByLabel('Registered company name').fill(org.legalName);
  await page.getByLabel('Tax code').fill(org.taxCode);
  await page.getByLabel('Registered address').fill(org.address);
  await page.getByLabel('Company phone').fill(org.phone);
  await page.getByLabel('Manager full name').fill(org.managerName);
  await page.getByLabel('Manager email').fill(org.managerEmail);
  await page.getByLabel('Manager phone').fill(org.managerPhone);
  await page.getByRole('button', { name: 'Register' }).click();

  await expect(
    page.getByText('Registration received. Visit the TrekLink counter or call us to verify your organization.'),
  ).toBeVisible();
  const code = page.locator('span.font-mono').filter({ hasText: /^ORG-\d{4}$/ });
  await expect(code).toBeVisible();
  orgCode = (await code.innerText()).trim();
  await expect(page.getByText('The Manager receives an email to set a password.', { exact: false })).toBeVisible();
});

test('MF-01a steps 3 and 4: Staff record the counter verification', async ({ page }) => {
  test.skip(!orgCode, 'needs the organization registered in steps 1 and 2');
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Organizations');
  await page.getByRole('tab', { name: 'Pending' }).click();
  await page.getByRole('button', { name: orgCode, exact: true }).click();

  await expect(page.getByRole('heading', { name: 'Counter verification' })).toBeVisible();
  await page.getByLabel('In person').check();
  await page.getByLabel('Business registration').check();
  await page.getByLabel('Manager ID card').check();
  await page.getByLabel('Master contract number').fill(`MC-2026-${stamp.slice(-4)}`);
  await page.getByLabel('The master contract includes the signed NDA').check();
  await page.getByLabel('The master contract includes the Field Station software licence').check();
  await page.getByRole('button', { name: 'Record verification' }).click();

  await expectToast(page, 'Saved.');
  await expect(page.getByText(/, in person, contract MC-2026-\d{4}$/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Update verification' })).toBeVisible();
  // Approval is an Admin decision: Staff see no Approve button.
  await expect(page.getByRole('button', { name: 'Approve', exact: true })).toHaveCount(0);
});

test('MF-01a step 5: the Admin approves', async ({ page }) => {
  test.skip(!orgCode, 'needs the organization registered in steps 1 and 2');
  await signIn(page, 'admin');
  await openFromSidebar(page, 'Organizations');
  await page.getByRole('tab', { name: 'Pending' }).click();
  await page.getByRole('button', { name: orgCode, exact: true }).click();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();

  await expectToast(page, `${orgCode} approved. The Manager can now request devices.`);
  await expect(page.getByRole('button', { name: orgCode, exact: true })).toHaveCount(0);
});

test('MF-01a steps 6 to 8: the Manager sets a password and signs in', async ({ page }) => {
  test.skip(!orgCode, 'needs the organization registered in steps 1 and 2');
  // Step 6 is a terminal step: the code is in the `[backend]` log line of the invitation.
  const code = invitationCodeFromLog(org.managerEmail);
  test.skip(!code, 'E2E_BACKEND_LOG does not name the backend log, or the invitation line is not in it');

  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Set password' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to TrekLink' })).toBeVisible();
  const password = `E2e-${stamp}`;
  await page.getByLabel('Email').fill(org.managerEmail);
  await page.getByLabel('Invitation code').fill(code ?? '');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.getByRole('button', { name: 'Set password and sign in' }).click();

  await page.waitForURL((url) => url.pathname === '/o');
  await expect(page.getByText(org.legalName).first()).toBeVisible();
});
