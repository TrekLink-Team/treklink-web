import { expect, test } from './support/fixtures';
import { appears, definitionOf, expectToast, openFromSidebar, runBackendScript, signIn, vnd } from './support/session';

// MF-05, demo script §6: term end to close on the seeded RC-2026-0002 (TL-0017, TL-0018): notice,
// term end, check-in, reset and inspection, the closing invoice, close. Optional steps 9 and 10 finish
// TL-0018's maintenance and retire TL-0008.
//
// Timed job: the term end is the rollover job at the 09:00 UTC+7 cutoff. The demo does not wait for it;
// step 2 runs `npm --prefix backend run demo:term-end -- RC-2026-0002` from the terminal, as here. It
// needs `backend/.env` in place before `prisma:generate` (script §1.2). The demo control panel stage
// `term-ended` (/t/admin/demo, DEMO_CONTROLS_ENABLED=true) replaces steps 1 and 2 for a rehearsal.

test.describe.configure({ mode: 'serial' });

const CONTRACT = 'RC-2026-0002';

const openContractAsStaff = async (page: import('@playwright/test').Page) => {
  await openFromSidebar(page, 'Contracts');
  await page.getByRole('tab', { name: 'All' }).click();
  await page.getByRole('button', { name: CONTRACT, exact: true }).click();
  await page.getByRole('link', { name: 'Open the contract' }).click();
  await expect(page).toHaveURL(/\/t\/contracts\/[^/]+$/);
};

test('MF-05 step 1: the Manager gives notice', async ({ page }) => {
  await signIn(page, 'manager');
  await openFromSidebar(page, 'Contracts');
  await page.getByRole('link', { name: CONTRACT, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Balance' })).toBeVisible();
  const give = page.getByRole('button', { name: 'Give notice' });
  test.skip(!(await appears(give, 3_000)), `${CONTRACT} is no longer ACTIVE; MF-05 needs a fresh seed`);
  await give.click();
  const dialog = page.getByRole('dialog', { name: `Give notice on ${CONTRACT}?` });
  await dialog.getByRole('button', { name: 'Give notice' }).click();
  await expectToast(page, /^Notice recorded\. The contract ends on .+; 0 VND is due then\.$/);
  await expect(page.getByText('Ending').first()).toBeVisible();
  await expect(page.getByText('Notice given').first()).toBeVisible();
});

test('MF-05 step 2: the term ends (demo:term-end)', async () => {
  const output = await runBackendScript('demo:term-end', [CONTRACT]);
  expect(output).toContain(`${CONTRACT}: MONTHLY, ENDING`);
  expect(output).toMatch(/Term rollover: \d+ renewed, 1 to RETURN_DUE, \d+ to RETURNED\./);
});

test('MF-05 steps 3 to 8: Staff check in, inspect, take the closing payment and close', async ({ page }) => {
  await signIn(page, 'staff');

  // Step 3
  await openContractAsStaff(page);
  const main = page.getByRole('main');
  await expect(main.getByText(/Return due/).first()).toBeVisible();
  await page.getByRole('link', { name: 'Open the counter' }).click();
  await expect(page.getByRole('heading', { name: `Counter: ${CONTRACT}` })).toBeVisible();
  const steps = page.getByRole('tablist', { name: 'Counter steps' });
  await expect(steps.getByRole('tab', { name: /Check-in/ })).toContainText('2');

  // Step 4
  const scan = page.getByLabel('Scan or type an asset tag');
  for (const tag of ['TL-0017', 'TL-0018']) {
    await scan.fill(tag);
    await page.getByRole('button', { name: 'Add', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Check in 2 devices' }).click();
  await expect(page.getByText('Check-in complete. 2 of 2 devices returned.')).toBeVisible();
  await expect(steps.getByRole('tab', { name: /Reset and inspection/ })).toContainText('2');

  // Step 5: reset each unit, then TL-0017 passes.
  await steps.getByRole('tab', { name: /Reset and inspection/ }).click();
  for (const tag of ['TL-0017', 'TL-0018']) {
    await page.getByRole('row').filter({ hasText: tag }).getByRole('button', { name: 'Record reset' }).click();
    const reset = page.getByRole('dialog');
    await reset.getByLabel('Channel key removed').check();
    await reset.getByLabel('Node database cleared').check();
    await reset.getByLabel('Owner name cleared').check();
    await reset.getByRole('button', { name: 'Record reset' }).click();
    await expectToast(page, 'Saved.');
    await expect(page.getByRole('row').filter({ hasText: tag })).toContainText('Reset logged');
  }
  await page.getByRole('row').filter({ hasText: 'TL-0017' }).getByRole('button', { name: 'Inspect' }).click();
  let inspect = page.getByRole('dialog', { name: 'Inspect TL-0017' });
  await inspect.getByLabel('Passed').check();
  await inspect.getByRole('button', { name: 'Record inspection' }).click();
  await expect(page.getByRole('row').filter({ hasText: 'TL-0017' })).toContainText('Passed, available');

  // Step 6: TL-0018 is damaged.
  await page.getByRole('row').filter({ hasText: 'TL-0018' }).getByRole('button', { name: 'Inspect' }).click();
  inspect = page.getByRole('dialog', { name: 'Inspect TL-0018' });
  await inspect.getByLabel('Damaged').check();
  await inspect.getByLabel('Casing cracked (CASING_CRACKED)').check();
  await inspect.getByRole('button', { name: 'Record inspection' }).click();
  const damaged = page.getByRole('row').filter({ hasText: 'TL-0018' });
  await expect(damaged).toContainText('Damaged, maintenance');
  await expect(damaged).toContainText(`Damage ${vnd(400_000)}, on the closing invoice`);

  // Step 7: the closing invoice at the counter.
  await steps.getByRole('tab', { name: 'Close' }).click();
  await expect(definitionOf(main, 'Due now')).toHaveText(vnd(400_000));
  await expect(definitionOf(main, 'Due later')).toHaveText(vnd(0));
  await expect(definitionOf(main, 'Paid')).toHaveText(vnd(900_000));
  await page.getByRole('link', { name: 'Open the invoices' }).click();
  await expect(page).toHaveURL(/\/t\/billing/);
  await expect(page.getByText('Showing one contract.')).toBeVisible();
  await page.getByRole('row').filter({ hasText: /CLOSING/i }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Record counter payment' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay).toContainText(`contract ${CONTRACT}, ORG-0001. Due now: ${vnd(400_000)}`);
  await expect(pay.getByLabel('Amount received (VND)')).toHaveValue('400000');
  await pay.getByLabel('Cash').check();
  await pay.getByLabel('Receipt number or bank reference').fill(`R-${Date.now()}`);
  await pay.getByRole('button', { name: 'Record', exact: true }).click();
  await expectToast(page, `Payment of ${vnd(400_000)} received.`);
  await expect(definitionOf(page, 'Paid')).toHaveText(vnd(400_000));
  await expect(definitionOf(page, 'Still due')).toHaveText(vnd(0));

  // Step 8: a RETURNED contract opens its counter on the Close tab.
  await openContractAsStaff(page);
  await page.getByRole('link', { name: 'Open the counter' }).click();
  await page.getByRole('region', { name: 'Close actions' }).or(page.getByLabel('Close actions'))
    .getByRole('button', { name: 'Close contract' }).click();
  const confirm = page.getByRole('dialog', { name: `Close contract ${CONTRACT}?` });
  await expect(confirm).toContainText('Holder labels are erased. A closed contract cannot be reopened.');
  await confirm.getByRole('button', { name: 'Close contract' }).click();
  await expectToast(page, 'Saved.');
  await expect(page.getByText('This contract is closed.')).toBeVisible();
  await expect(definitionOf(page.getByRole('main'), 'Paid')).toHaveText(vnd(1_300_000));
});

test('MF-05 step 9 (optional): TL-0018 completes maintenance and passes an intake check', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Maintenance');
  const row = page.getByRole('row').filter({ hasText: 'TL-0018' }).filter({ visible: true }).first();
  test.skip(!(await appears(row)), 'no open maintenance on TL-0018 (step 6 did not run on this seed)');
  await row.getByRole('button', { name: 'Complete' }).click();
  const dialog = page.getByRole('dialog', { name: 'Complete maintenance for TL-0018' });
  await dialog.getByLabel('Completed').check();
  await dialog.getByRole('textbox', { name: /^Resolution/ }).fill('Casing replaced');
  await dialog.getByRole('spinbutton', { name: /^Actual cost/ }).or(dialog.getByRole('textbox', { name: /^Actual cost/ })).fill('0');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('TL-0018 stays in maintenance until it passes an intake check on its page.')).toBeVisible();

  await page.getByRole('link', { name: 'Open TL-0018' }).click();
  await page.getByRole('button', { name: 'Record intake check' }).click();
  const intake = page.getByRole('dialog', { name: 'Record intake check' });
  await intake.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('main').getByText('Available').first()).toBeVisible();
});

test('MF-05 step 10 (optional): TL-0008 is marked unrepairable, retired and disposed', async ({ page, browser }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Maintenance');
  await page.getByRole('button', { name: 'Open maintenance' }).first().click();
  const pick = page.getByRole('dialog', { name: 'Open maintenance' });
  await pick.getByLabel('Search').fill('TL-0008');
  const device = pick.getByLabel('Device');
  const option = device.locator('option', { hasText: 'TL-0008' });
  test.skip(!(await appears(option)), 'TL-0008 is not AVAILABLE on this seed');
  await device.selectOption((await option.getAttribute('value')) ?? '');
  await pick.getByRole('button', { name: 'Continue' }).click();
  const open = page.getByRole('dialog', { name: 'Open maintenance for TL-0008' });
  await open.getByRole('textbox', { name: /^Description/ }).fill('Radio does not transmit');
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
  await open.getByLabel(/^Expected completion/).fill(tomorrow);
  await open.getByRole('button', { name: 'Open maintenance' }).click();

  const row = page.getByRole('row').filter({ hasText: 'TL-0008' }).filter({ visible: true }).first();
  await row.getByRole('button', { name: 'Complete' }).click();
  const complete = page.getByRole('dialog', { name: 'Complete maintenance for TL-0008' });
  await complete.getByLabel('Unrepairable').check();
  await complete.getByRole('textbox', { name: /^Resolution/ }).fill('Radio board burnt');
  await complete.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('dialog', { name: /^Mark TL-0008 unrepairable\?/ }).getByRole('button', { name: 'Mark unrepairable' }).click();
  await expect(page.getByText('TL-0008 stays in maintenance until an Admin retires it.')).toBeVisible();

  // The Admin retires and disposes (window D).
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, 'admin');
  await openFromSidebar(admin, 'Devices');
  await admin.getByRole('link', { name: 'TL-0008', exact: true }).first().click();
  await admin.getByRole('button', { name: 'Retire' }).click();
  const retire = admin.getByRole('dialog', { name: 'Retire device TL-0008?' });
  await retire.getByRole('textbox', { name: /^Reason/ }).fill('Unrepairable radio');
  await retire.getByRole('button', { name: 'Retire' }).click();
  await expect(admin.getByRole('main').getByText('Retired').first()).toBeVisible();
  await admin.getByRole('button', { name: 'Dispose' }).click();
  const dispose = admin.getByRole('dialog', { name: 'Dispose of TL-0008?' });
  await dispose.getByLabel('Key removed').check();
  await dispose.getByLabel('Node database cleared').check();
  await dispose.getByLabel('Owner cleared').check();
  await dispose.getByRole('textbox', { name: /^Method/ }).fill('Certified e-waste recycler');
  await dispose.getByRole('button', { name: 'Dispose' }).click();
  await expect(admin.getByRole('main').getByText('Disposed').first()).toBeVisible();
  await adminContext.close();
});
