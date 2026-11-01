import { expect, test } from './support/fixtures';
import { appears, definitionOf, expectToast, openFromSidebar, runBackendScript, signIn, vnd } from './support/session';

// MF-03, demo script §4: an SOS from TL-0010 reaches the Operator, who acknowledges, responds,
// corrects a status update and resolves; Staff report the seeded UNROUTED incident and the seeded
// DEFAULTED contract RC-2026-0003 to the authority.
//
// Step 1 publishes the recorded SOS fixture to the broker exactly as the presenter does from the
// terminal (`npm --prefix backend run replay:mqtt -- sos --now --new-ids`), so the broker in
// MQTT_BROKER_URL and the backend ingestion must be running. Run it at least 5 minutes after
// `seed:demo` (gatewaySync.attributionMarginSeconds), or the SOS opens an UNROUTED incident instead.
// The escalation timers are not waited for: the happy path acknowledges first.

test.describe.configure({ mode: 'serial' });

const suffix = Date.now().toString().slice(-4);
const incidentReference = `LD-2026-1${suffix}`;
const contractReference = `LD-2026-2${suffix}`;
const agency = 'Lam Dong Provincial Police';
// The close dialog joins the reference with non-breaking hyphens (AuthorityReports.tsx).
const shownReference = (reference: string) => new RegExp(reference.replace(/-/g, '[-‑]'));

test('MF-03 steps 1 to 6: the Operator handles the SOS from TL-0010', async ({ page }) => {
  await signIn(page, 'operator');
  await expect(page).toHaveURL(/\/o\/map$/);

  // Step 1 (terminal)
  await runBackendScript('replay:mqtt', ['sos', '--now', '--new-ids']);

  // Step 2: the banner on every page, and the map header.
  const banner = page.getByRole('alert').filter({ hasText: /SOS: TL-0010 \(Pham Van F\), \d{2}:\d{2}\. Acknowledge now\./ });
  await expect(banner).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/\d+ devices?, 1 SOS open/)).toBeVisible();

  // Step 3
  await openFromSidebar(page, 'Incidents');
  await page.getByRole('row').filter({ hasText: 'TL-0010' }).first().getByRole('link').first().click();
  const main = page.getByRole('main');
  await expect(main.getByText('TL-0010').first()).toBeVisible();
  await expect(main.getByText('Pham Van F').first()).toBeVisible();
  await expect(main.getByText('Unclaimed').first()).toBeVisible();
  await expect(main.getByText('Notifying primary').first()).toBeVisible();
  await expect(main.getByText('Last known coordinates')).toBeVisible();

  // Step 4
  await main.getByRole('button', { name: 'Acknowledge', exact: true }).click();
  await expectToast(page, 'Saved.');
  await expect(main.getByText('Demo Operator').first()).toBeVisible();
  await expect(main.getByText('Acknowledged').first()).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Step 5
  await main.getByRole('button', { name: 'Response under way' }).click();
  await main.getByRole('textbox', { name: /^What is being done/ }).fill('Ranger team dispatched from the Ta Nang post');
  await main.getByRole('button', { name: 'Save response' }).click();
  await expect(main.getByText('Responding').first()).toBeVisible();
  await main.getByRole('button', { name: 'Add status' }).click();
  await main.getByRole('textbox', { name: /^Status update/ }).fill('Team left the post');
  await main.getByRole('button', { name: 'Save status' }).click();
  await expect(main.getByText('Team left the post')).toBeVisible();

  // Step 5b: a correction keeps the original, marked corrected.
  await main.getByRole('button', { name: /^Correct the update of / }).first().click();
  await expect(main.getByText(/Corrects the update of .*The original stays in the history, marked corrected\./)).toBeVisible();
  await main.getByRole('textbox', { name: /^Corrected status update/ }).fill('Team at km 6, voice contact with the hiker');
  await main.getByRole('button', { name: 'Save correction' }).click();
  await expectToast(page, 'Saved.');
  await expect(main.getByText(/^Correction of /)).toBeVisible();
  await expect(main.getByText('Corrected', { exact: true })).toBeVisible();

  // Step 6
  await main.getByRole('button', { name: 'Report outcome' }).click();
  await main.getByRole('textbox', { name: /^Outcome/ }).fill('Hiker found, minor ankle injury, walked out');
  await main.getByRole('button', { name: 'Resolve incident' }).click();
  await expect(main.getByText('Resolved').first()).toBeVisible();
  await expect(main.getByText('Hiker found, minor ankle injury, walked out').first()).toBeVisible();
  await expect(main.getByText(/Response under way, by Demo Operator/)).toBeVisible();
  await expect(main.getByText(/Resolved, by Demo Operator/)).toBeVisible();
  // Correct is offered only while the incident is open to its owner.
  await expect(main.getByRole('button', { name: /^Correct the update of / })).toHaveCount(0);
});

test('MF-03 steps 7 to 10: Staff report the UNROUTED TL-0001 incident and close the case', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Incidents');
  await page.getByRole('group', { name: 'Queue filter' }).getByRole('button', { name: 'Unrouted and escalated' }).click();
  const row = page.getByRole('row').filter({ hasText: 'TL-0001' }).filter({ hasText: 'Unrouted' });
  // The seed opens it once; a rehearsal that closed it needs the TL-0002 fallback (script §8).
  test.skip(!(await appears(row)), 'the seeded UNROUTED incident on TL-0001 is no longer open');
  await row.first().getByRole('button').first().click();

  // Step 7
  const main = page.getByRole('main');
  await expect(main.getByText('No holder label').first()).toBeVisible();
  await expect(main.getByText('TrekLink Staff queue').first()).toBeVisible();

  // Step 8
  await main.getByRole('button', { name: 'Report to authorities' }).click();
  const report = page.getByRole('dialog');
  await report.getByLabel('Agency').fill(agency);
  await report.getByLabel('Authority reference').fill(incidentReference);
  await expect(report.getByLabel('Reported at')).not.toHaveValue('');
  await expect(report.getByText(/Your time zone, Asia\/(Saigon|Ho_Chi_Minh)\. Not in the future\./)).toBeVisible();
  await report.getByRole('button', { name: 'Record report' }).click();
  await expectToast(page, 'Saved.');
  await expect(main.getByText('Reported to authority').first()).toBeVisible();
  await expect(main.getByText(new RegExp(`${agency}, ${incidentReference}, reported .*case open`))).toBeVisible();

  // Step 9
  await page.getByRole('tab', { name: 'Authority reports' }).click();
  const reportRow = page.getByRole('row').filter({ hasText: incidentReference });
  await reportRow.getByRole('button', { name: 'Record case closed' }).click();
  const close = page.getByRole('dialog');
  await expect(close).toContainText(shownReference(incidentReference));
  await close.getByRole('button', { name: 'Record case closed' }).click();
  await expectToast(page, 'Saved.');
  await expect(reportRow).toHaveCount(0);

  // Step 10
  await page.getByLabel('Open cases only').uncheck();
  await page.getByRole('row').filter({ hasText: incidentReference }).getByRole('link', { name: 'View incident' }).or(
    page.getByRole('row').filter({ hasText: incidentReference }).getByRole('button', { name: 'View incident' }),
  ).first().click();
  await expect(main.getByText('Closed').first()).toBeVisible();
  await expect(main.getByText(new RegExp(`${incidentReference}, reported .*case closed`))).toBeVisible();
});

test('MF-03 steps 11 to 13: Staff report the DEFAULTED contract RC-2026-0003', async ({ page }) => {
  await signIn(page, 'staff');
  await openFromSidebar(page, 'Incidents');
  await page.getByRole('tab', { name: 'Authority reports' }).click();

  // Step 11
  await page.getByRole('button', { name: 'Record report' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Subject kind').selectOption('contract');
  await expect(dialog.getByText('Only defaulted contracts can be reported.')).toBeVisible();
  const eligible = dialog.getByRole('list', { name: 'Eligible records' }).getByRole('button', {
    name: /RC-2026-0003, TrekLink Demo Tours Co\., Ltd\./,
  });
  await expect(eligible).toContainText('Defaulted');

  // Step 12
  await eligible.click();
  await dialog.getByLabel('Agency').fill(agency);
  await dialog.getByLabel('Authority reference').fill(contractReference);
  await dialog.getByLabel('Note').fill('Device TL-0019 not returned after default');
  await dialog.getByRole('button', { name: 'Record report' }).click();
  await expectToast(page, 'Saved.');
  const row = page.getByRole('row').filter({ hasText: contractReference });
  await expect(row.getByRole('link', { name: 'View contract' }).or(row.getByRole('button', { name: 'View contract' }))).toBeVisible();

  // Step 13: a report never changes the contract.
  await row.getByRole('link', { name: 'View contract' }).or(row.getByRole('button', { name: 'View contract' })).first().click();
  await expect(page).toHaveURL(/\/t\/contracts\/[^/]+$/);
  const main = page.getByRole('main');
  await expect(main.getByText('RC-2026-0003').first()).toBeVisible();
  await expect(main.getByText('Defaulted').first()).toBeVisible();
  // The unpaid balance of term 1; the holding fee was paid at handover.
  await expect(definitionOf(main, 'Due now')).toHaveText(vnd(225_000));
  await expect(definitionOf(main, 'Due later')).toHaveText(vnd(0));
  await expect(definitionOf(main, 'Paid')).toHaveText(vnd(225_000));
});
