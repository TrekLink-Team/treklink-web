import type { APIRequestContext } from '@playwright/test';
import { expect, test } from './support/fixtures';
import {
  apiGet,
  apiToken,
  appears,
  definitionOf,
  expectToast,
  homeAction,
  moneyText,
  openFromSidebar,
  runBackendScript,
  showOnly,
  signIn,
  titleStatus,
  typeMoney,
  vnd,
} from './support/session';

// MF-05, demo script §6: term end to close on the seeded RC-2026-0002 (TL-0017, TL-0018): notice,
// term end, check-in of TL-0017 only, Report lost on TL-0018 (D-092 rule 3), TL-0017 inspected Damaged,
// the loss case triaged and confirmed by Staff and settled by an Admin, the closing invoice (damage
// 400,000 plus loss 2,500,000 VND), close. Optional steps 13 and 14 finish TL-0017's maintenance and
// retire TL-0008.
//
// Timed job: the term end is the rollover job at the 09:00 UTC+7 cutoff. The demo does not wait for it;
// step 2 runs `npm --prefix backend run demo:term-end -- RC-2026-0002` from the terminal, as here. It
// needs `backend/.env` in place before `prisma:generate` (script §1.2). The demo control panel stage
// `term-ended` (/t/admin/demo, DEMO_CONTROLS_ENABLED=true) replaces steps 1 and 2 for a rehearsal.

test.describe.configure({ mode: 'serial' });

const CONTRACT = 'RC-2026-0002';

// The loss case of TL-0018, opened at the counter in step 5 and carried to the Staff and Admin steps.
let lossCaseUrl: string | undefined;
let lossCaseCode: string | undefined;

// The contract's status read from the API, for the steps that skip on a seed where an earlier run
// already moved RC-2026-0002 on (demo:term-end then answers "RC-2026-0002 has no open term.").
const contractStatus = async (request: APIRequestContext): Promise<string | undefined> => {
  const token = await apiToken(request, 'staff');
  const page = await apiGet<{ items: { code: string; status: string }[] }>(request, token, '/contracts?pageSize=100');
  return page.items.find((contract) => contract.code === CONTRACT)?.status;
};

const openContractAsStaff = async (page: import('@playwright/test').Page) => {
  await openFromSidebar(page, 'Contracts');
  // The queue is the list's Show menu (treklink-web#350); Show details opens the contract in the
  // details pane, whose link opens the contract home.
  await showOnly(page, 'All');
  await page.getByRole('button', { name: `Show details of ${CONTRACT}`, exact: true }).click();
  await page.getByRole('complementary', { name: CONTRACT }).getByRole('link', { name: 'Open the contract' }).click();
  await expect(page).toHaveURL(/\/t\/contracts\/[^/]+$/);
};

test('MF-05 step 1: the Manager gives notice', async ({ page }) => {
  await signIn(page, 'manager');
  await openFromSidebar(page, 'Contracts');
  await page.getByRole('link', { name: CONTRACT, exact: true }).first().click();
  // The contract home (#349): Give notice is the primary action, or in More actions while an invoice
  // is open (widgets/ContractHome/policy.ts).
  await expect(page.getByRole('heading', { level: 1 })).toContainText(CONTRACT);
  test.skip(!(await appears(titleStatus(page, 'Active'), 5_000)), `${CONTRACT} is no longer ACTIVE; MF-05 needs a fresh seed`);
  await expect(titleStatus(page, 'Ending')).toHaveCount(0);
  await homeAction(page, 'Give notice');
  const dialog = page.getByRole('dialog', { name: `Give notice on ${CONTRACT}?` });
  await dialog.getByRole('button', { name: 'Give notice' }).click();
  await expectToast(page, /Notice recorded\. The contract ends on .+; 0 VND is due then\./);
  await expect(titleStatus(page, 'Ending')).toBeVisible();
  await expect(page.getByText('Notice given').first()).toBeVisible();
});

test('MF-05 step 2: the term ends (demo:term-end)', async ({ request }) => {
  const status = await contractStatus(request);
  test.skip(status !== 'ENDING', `${CONTRACT} is ${status ?? 'missing'}, not ENDING; MF-05 needs a fresh seed`);
  const output = await runBackendScript('demo:term-end', [CONTRACT]);
  expect(output).toContain(`${CONTRACT}: MONTHLY, ENDING`);
  expect(output).toMatch(/Term rollover: \d+ renewed, 1 to RETURN_DUE, \d+ to RETURNED\./);
});

test('MF-05 steps 3 to 7: Staff check in TL-0017, report TL-0018 lost, inspect and read the blockers', async ({
  page,
  request,
}) => {
  const status = await contractStatus(request);
  test.skip(status !== 'RETURN_DUE', `${CONTRACT} is ${status ?? 'missing'}, not RETURN_DUE; MF-05 needs a fresh seed`);
  await signIn(page, 'staff');

  // Step 3
  await openContractAsStaff(page);
  const main = page.getByRole('main');
  await expect(main.getByText(/Return due/).first()).toBeVisible();
  // The contract home (#349) opens the return counter with its primary action, Record return.
  await homeAction(page, 'Record return');
  await expect(page.getByRole('heading', { name: `Counter: ${CONTRACT}` })).toBeVisible();
  const steps = page.getByRole('tablist', { name: 'Counter steps' });
  await expect(steps.getByRole('tab', { name: /Check-in/ })).toContainText('2');

  // Step 4: only TL-0017 comes back; TL-0018 stands for the unit that did not.
  await page.getByLabel('Scan or type an asset tag').fill('TL-0017');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByRole('button', { name: 'Check in 1 device' }).click();
  await expect(page.getByText('Check-in complete. 1 of 2 devices returned.')).toBeVisible();
  const stillOut = page.getByRole('heading', { name: 'Still out' }).locator('xpath=..');
  await expect(stillOut).toContainText('A unit that did not come back needs no replacement: report it lost.');
  await expect(stillOut.getByRole('listitem').filter({ hasText: 'TL-0018' })).toBeVisible();
  await expect(steps.getByRole('tab', { name: /Reset and inspection/ })).toContainText('1');

  // Step 5: Report lost on TL-0018, then follow the link to its loss case.
  await stillOut.getByRole('listitem').filter({ hasText: 'TL-0018' }).getByRole('button', { name: 'Report lost' }).click();
  const report = page.getByRole('dialog', { name: 'Report TL-0018 lost' });
  await report.getByLabel('Description').fill('Not handed back at the end of the term; the organization cannot find it.');
  await report.getByRole('button', { name: 'Report lost' }).click();
  await expectToast(page, /Loss case LOSS-\d+ opened for TL-0018\./);
  const caseLink = stillOut.getByRole('link', { name: /^Loss case LOSS-\d+ open$/ });
  await expect(caseLink).toBeVisible();
  lossCaseCode = (await caseLink.innerText()).match(/LOSS-\d+/)?.[0];
  expect(lossCaseCode).toBeTruthy();
  await caseLink.click();
  await expect(page).toHaveURL(/\/t\/loss-cases\/[^/]+$/);
  lossCaseUrl = new URL(page.url()).pathname;
  await page.goBack();
  await expect(page.getByRole('heading', { name: `Counter: ${CONTRACT}` })).toBeVisible();

  // Step 6: reset TL-0017, then it is damaged.
  await steps.getByRole('tab', { name: /Reset and inspection/ }).click();
  const row = page.getByRole('row').filter({ hasText: 'TL-0017' });
  await row.getByRole('button', { name: 'Record reset' }).click();
  const reset = page.getByRole('dialog');
  await reset.getByLabel('Channel key removed').check();
  await reset.getByLabel('Node database cleared').check();
  await reset.getByLabel('Owner name cleared').check();
  await reset.getByRole('button', { name: 'Record reset' }).click();
  await expectToast(page, 'Saved.');
  await expect(row).toContainText('Reset logged');
  await row.getByRole('button', { name: 'Inspect' }).click();
  const inspect = page.getByRole('dialog', { name: 'Inspect TL-0017' });
  await inspect.getByLabel('Damaged').check();
  await inspect.getByLabel('Casing cracked (CASING_CRACKED)').check();
  await inspect.getByRole('button', { name: 'Record inspection' }).click();
  await expect(row).toContainText('Damaged, maintenance');
  await expect(row).toContainText(`Damage ${vnd(400_000)}, on the closing invoice`);
  await expect(row).toContainText('Next: Complete maintenance');

  // Step 7: the Close tab lists what still blocks the close and offers no Close action.
  await steps.getByRole('tab', { name: 'Close' }).click();
  await expect(main.getByRole('heading', { name: 'What still blocks the close' })).toBeVisible();
  await expect(main.getByText(`TL-0018 is not back; its loss case ${lossCaseCode} is not settled yet.`)).toBeVisible();
  await expect(main.getByRole('link', { name: `Open loss case ${lossCaseCode}` })).toBeVisible();
  await expect(main.getByText(`${vnd(400_000)} is unpaid on the contract's invoices.`)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close contract' })).toHaveCount(0);
});

test('MF-05 step 8: Staff triage and confirm the loss of TL-0018', async ({ page }) => {
  test.skip(!lossCaseUrl, 'no loss case from step 5 on this seed');
  await signIn(page, 'staff', lossCaseUrl);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(lossCaseCode ?? '');
  await page.getByRole('button', { name: 'Triage', exact: true }).click();
  const triage = page.getByRole('dialog', { name: `Triage ${lossCaseCode}` });
  await triage.getByRole('button', { name: 'Triage', exact: true }).click();
  await expectToast(page, 'Saved.');
  await page.getByRole('button', { name: 'Confirm loss' }).click();
  const confirm = page.getByRole('dialog', { name: 'Confirm TL-0018 lost?' });
  await expect(confirm).toContainText('The device remaining value is charged to the renting contract.');
  await confirm.getByRole('button', { name: 'Confirm loss' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Confirmed');
});

test('MF-05 step 9: the Admin settles the loss case, so the contract is Returned', async ({ browser, request }) => {
  test.skip(!lossCaseUrl, 'no loss case from step 5 on this seed');
  // Staff triaged the case, so only an Admin who did not may settle it.
  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  await signIn(admin, 'admin', lossCaseUrl);
  await admin.getByRole('button', { name: 'Settle', exact: true }).click();
  const settle = admin.getByRole('dialog', { name: `Settle ${lossCaseCode}` });
  await expect(settle).toContainText(`Charge raised at confirmation: ${vnd(2_500_000)}.`);
  await settle.getByLabel('Charged').check();
  await settle.getByRole('button', { name: 'Settle', exact: true }).click();
  await expectToast(admin, 'Saved.');
  await expect(admin.getByRole('heading', { level: 1 })).toContainText('Settled');
  await adminContext.close();
  expect(await contractStatus(request)).toBe('RETURNED');
});

test('MF-05 steps 10 to 12: Staff take the closing payment and close the contract', async ({ page, request }) => {
  const status = await contractStatus(request);
  test.skip(status !== 'RETURNED', `${CONTRACT} is ${status ?? 'missing'}, not RETURNED; MF-05 needs a fresh seed`);
  await signIn(page, 'staff');

  // Step 10: the counter reads Returned and only the balance is left.
  await openContractAsStaff(page);
  await homeAction(page, 'Open the counter');
  const steps = page.getByRole('tablist', { name: 'Counter steps' });
  await steps.getByRole('tab', { name: 'Close' }).click();
  const main = page.getByRole('main');
  await expect(main.getByText(`${vnd(2_900_000)} is unpaid on the contract's invoices.`)).toBeVisible();
  await expect(main.getByText(/is not back/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Close contract' })).toHaveCount(0);
  await expect(definitionOf(main, 'Due now')).toHaveText(vnd(2_900_000));
  await expect(definitionOf(main, 'Paid')).toHaveText(vnd(900_000));

  // Step 11: the closing invoice at the counter, damage 400,000 plus loss 2,500,000.
  await main.getByRole('link', { name: 'Open the invoices' }).click();
  await expect(page).toHaveURL(/\/t\/billing/);
  await expect(page.getByText('Showing one contract.')).toBeVisible();
  await page.getByRole('row').filter({ hasText: /CLOSING/i }).getByRole('button').first().click();
  await page.getByRole('button', { name: 'Record counter payment' }).click();
  const pay = page.getByRole('dialog');
  await expect(pay).toContainText(`contract ${CONTRACT}, ORG-0001. Due now: ${vnd(2_900_000)}`);
  await expect(pay.getByLabel('Amount received (VND)')).toHaveValue(moneyText(2_900_000));
  await pay.getByLabel('Cash').check();
  await pay.getByLabel('Receipt number or bank reference').fill(`R-${Date.now()}`);
  await pay.getByRole('button', { name: 'Record', exact: true }).click();
  await expectToast(page, `Payment of ${vnd(2_900_000)} received.`);
  await expect(definitionOf(page, 'Paid')).toHaveText(vnd(2_900_000));
  await expect(definitionOf(page, 'Still due')).toHaveText(vnd(0));

  // Step 12: a RETURNED contract opens its counter on the Close tab.
  await openContractAsStaff(page);
  await homeAction(page, 'Open the counter');
  await expect(page.getByText('Nothing blocks the close. Close the contract below.')).toBeVisible();
  await page.getByRole('region', { name: 'Close actions' }).or(page.getByLabel('Close actions'))
    .getByRole('button', { name: 'Close contract' }).click();
  const confirm = page.getByRole('dialog', { name: `Close contract ${CONTRACT}?` });
  await expect(confirm).toContainText('Holder labels are erased. A closed contract cannot be reopened.');
  await confirm.getByRole('button', { name: 'Close contract' }).click();
  await expectToast(page, `${CONTRACT} closed.`);
  await expect(page.getByText('This contract is closed.')).toBeVisible();
  await expect(definitionOf(page.getByRole('main'), 'Paid')).toHaveText(vnd(3_800_000));
});

test('MF-05 step 13 (optional): TL-0017 completes maintenance and passes an intake check', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Maintenance');
  // An open record offers Complete; a completed one from an earlier run on this seed does not.
  const complete = page
    .getByRole('row')
    .filter({ hasText: 'TL-0017' })
    .filter({ visible: true })
    .getByRole('button', { name: 'Complete' })
    .first();
  test.skip(!(await appears(complete)), 'no open maintenance on TL-0017 (step 6 did not run on this seed)');
  await complete.click();
  const dialog = page.getByRole('dialog', { name: 'Complete maintenance for TL-0017' });
  await dialog.getByLabel('Completed').check();
  await dialog.getByRole('textbox', { name: /^Resolution/ }).fill('Casing replaced');
  await typeMoney(dialog.getByRole('textbox', { name: /^Actual cost/ }), 0);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('TL-0017 stays in maintenance until it passes an intake check on its page.')).toBeVisible();

  await page.getByRole('link', { name: 'Open TL-0017' }).click();
  await expect(page).toHaveURL(/\/t\/devices\/[^/]+$/);
  // The device history already lists "From In intake to Available (Intake passed)": only the status badge counts.
  await expect(titleStatus(page, 'Maintenance')).toBeVisible();
  await expect(titleStatus(page, 'Available')).toHaveCount(0);
  await expect(page.getByText('Next step: Intake check')).toBeVisible();
  await page.getByRole('button', { name: 'Record intake check' }).click();
  const intake = page.getByRole('dialog', { name: 'Record intake check' });
  await intake.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(titleStatus(page, 'Available')).toBeVisible();
});

test('MF-05 step 14 (optional): TL-0008 is marked unrepairable, retired and disposed', async ({ page, browser }) => {
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
  await expect(admin).toHaveURL(/\/t\/devices\/[^/]+$/);
  // The fleet list also has a "Retire device" row action and a "Retired" filter: exact name only.
  await admin.getByRole('button', { name: 'Retire', exact: true }).click();
  const retire = admin.getByRole('dialog', { name: 'Retire device TL-0008?' });
  await retire.getByRole('textbox', { name: /^Reason/ }).fill('Unrepairable radio');
  await retire.getByRole('button', { name: 'Retire' }).click();
  await expect(titleStatus(admin, 'Retired')).toBeVisible();
  await admin.getByRole('button', { name: 'Dispose' }).click();
  const dispose = admin.getByRole('alertdialog', { name: 'Dispose of TL-0008?' });
  await dispose.getByLabel('Key removed').check();
  await dispose.getByLabel('Node database cleared').check();
  await dispose.getByLabel('Owner cleared').check();
  await dispose.getByRole('textbox', { name: /^Method/ }).fill('Certified e-waste recycler');
  await dispose.getByRole('button', { name: 'Dispose' }).click();
  await expect(titleStatus(admin, 'Disposed')).toBeVisible();
  await adminContext.close();
});
