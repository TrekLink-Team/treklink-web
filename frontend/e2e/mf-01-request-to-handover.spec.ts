import type { Page } from '@playwright/test';
import { expect, test } from './support/fixtures';
import { expectToast, openFromSidebar, signIn, vnd } from './support/session';

// MF-01, demo script §2b: the Manager requests a contract, Staff approve it and run the counter
// handover (devices, payment, preview note, signature), then the Manager creates a Field Station
// credential. Seeded ORG-0001, ten treklink-v3 units (script §1.3).

test.describe.configure({ mode: 'serial' });

let contractCode = '';
let reservedTag = '';

// Today's date and wall clock as the counter sees them, in the demo time zone.
const localNow = () => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, hour: Number(part('hour')) };
};

const drawSignature = async (page: Page) => {
  const pad = page.getByRole('img', { name: 'Signature area, drawn by the Manager' }).or(
    page.getByLabel('Signature area, drawn by the Manager'),
  );
  const box = await pad.boundingBox();
  if (!box) throw new Error('signature pad not laid out');
  await page.mouse.move(box.x + 20, box.y + box.height / 2);
  await page.mouse.down();
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(box.x + 20 + step * 20, box.y + box.height / 2 + (step % 2 ? 15 : -15));
  }
  await page.mouse.up();
};

test('MF-01 step 0: the public plans page', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Rent TrekLink devices' })).toBeVisible();
  await expect(page.getByText('Sandbox price').first()).toBeVisible();
  await expect(page.getByText('How renting works')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' }).first()).toBeVisible();
});

test('MF-01 steps 1 to 4: the Manager requests five v3 units', async ({ page }) => {
  await signIn(page, 'manager');
  await expect(page).toHaveURL(/\/o$/);
  await page.getByRole('link', { name: 'Request a contract' }).first().click();
  await expect(page.getByRole('list', { name: 'Steps' })).toContainText('Plan and devices');

  // Step 2
  await page.getByLabel('Monthly').check();
  const variant = page.getByLabel('Hardware variant');
  const v3 = variant.locator('option', { hasText: 'TrekLink v3' });
  await variant.selectOption((await v3.getAttribute('value')) ?? '');
  await expect(v3).toHaveText(/450,000 VND per device per month/);
  await page.getByLabel('Quantity').fill('5');
  await expect(page.getByText('At least 5 devices.')).toBeVisible();
  const quote = page.getByLabel('Quote');
  await expect(quote).toContainText(vnd(2_250_000));
  await expect(quote).toContainText(vnd(1_125_000));
  await expect(quote).toContainText('Formula: 450000 x 5 x 0.5');
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 3: the handover day is today, the earliest date allowed.
  const startDate = page.getByLabel('Start date (handover day)');
  await expect(startDate).toHaveAttribute('min', localNow().date);
  await startDate.fill(localNow().date);
  await page.getByRole('button', { name: 'Next' }).click();

  // Step 4
  await page.getByRole('button', { name: 'Send request' }).click();
  await expectToast(page, 'Request sent. TrekLink will confirm availability and your handover appointment.');
  const code = page.getByText(/^RC-\d{4}-\d{4}$/).first();
  await expect(code).toBeVisible();
  contractCode = (await code.innerText()).trim();
  await expect(page.getByText('Requested').first()).toBeVisible();
});

test('MF-01 steps 5 to 12: Staff approve and hand over at the counter', async ({ page }) => {
  test.skip(!contractCode, 'needs the contract requested in steps 1 to 4');
  await signIn(page, 'staff');

  // Step 5
  await openFromSidebar(page, 'Contracts');
  await page.getByRole('tab', { name: 'Requested' }).click();
  await page.getByRole('button', { name: contractCode, exact: true }).click();
  await expect(page.getByText(/TrekLink v3 \(GPS, SOS button\) available now; approval reserves 5\./)).toBeVisible();

  // Step 6: the appointment opens on today 09:00; after 09:00 it moves to the next full hour.
  const { date, hour } = localNow();
  const appointment = page.getByLabel('Handover appointment');
  await expect(appointment).toHaveValue(`${date}T09:00`);
  if (hour >= 9) {
    const next = Math.min(hour + 1, 23);
    await appointment.fill(`${date}T${String(next).padStart(2, '0')}:${next === 23 ? '59' : '00'}`);
  }
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expectToast(page, `${contractCode} approved. 5 devices reserved.`);
  const reserved = page.getByText(/^Reserved: TL-\d{4}/);
  await expect(reserved).toBeVisible();
  reservedTag = /TL-\d{4}/.exec(await reserved.innerText())?.[0] ?? '';
  await expect(page.getByText(/Reservation expires/)).toBeVisible();

  // Step 7
  await page.getByRole('link', { name: 'Open the contract' }).click();
  await page.getByRole('link', { name: 'Open the counter' }).click();
  await expect(page.getByRole('heading', { name: `Counter handover: ${contractCode}` })).toBeVisible();

  // Step 8: readings first, then provisioning, on one selection.
  await page.getByLabel('Scan or type an asset tag').fill(reservedTag);
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.getByText(`${reservedTag} is on this contract.`)).toBeVisible();
  await page.getByLabel('Select all units').check();
  await expect(page.getByText('5 of 5 selected')).toBeVisible();
  await page.getByLabel('Battery % for selected').fill('90');
  await page.getByLabel('GPS fix for selected').selectOption('ok');
  await page.getByRole('button', { name: 'Set readings for selected' }).click();
  await expect(page.getByText('Readings set on 5 units.')).toBeVisible();
  await expect(page.getByText('5 of 5 selected')).toBeVisible();
  await page.getByRole('button', { name: 'Record provisioning for selected' }).click();
  await expect(page.getByText('Recorded 5 of 5.')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Provisioned v1')).toHaveCount(5);
  const actions = page.getByRole('region', { name: 'Handover steps' }).or(page.getByLabel('Handover steps'));
  await actions.getByRole('button', { name: 'Next' }).click();

  // Step 9: the holding fee. Before 09:00 local it is not due yet and the prefill is the whole term
  // fee, so the presenter types 1125000 (script step 9, both branches).
  await page.getByRole('button', { name: 'Record a counter payment' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`contract ${contractCode}, ORG-0001`);
  const amount = dialog.getByLabel('Amount received (VND)');
  if ((await amount.inputValue()) !== '1125000') {
    await expect(dialog).toContainText(`Due later: ${vnd(2_250_000)}`);
    await amount.fill('1125000');
  } else {
    await expect(dialog).toContainText(`Due now: ${vnd(1_125_000)}`);
    await expect(dialog).toContainText(`Due later: ${vnd(1_125_000)}`);
  }
  await dialog.getByLabel('Cash').check();
  await dialog.getByLabel('Receipt number or bank reference').fill(`R-${Date.now()}`);
  await dialog.getByRole('button', { name: 'Record', exact: true }).click();
  await expectToast(page, `Payment of ${vnd(1_125_000)} received.`);
  await expect(page.getByText('The first payment is recorded.')).toBeVisible();

  // Step 10: the unsigned note preview.
  await actions.getByRole('button', { name: 'Next' }).click();
  // The frame shows the rendered PDF, which the browser's viewer draws outside the DOM: the test checks
  // that a PDF is framed. Its text (the PREVIEW banner, "90 %", "Fix OK") is the renderer's, covered by
  // backend/src/modules/rentals/handover-note.renderer tests.
  const preview = page.locator('iframe[title="Handover note preview, not signed"]');
  await expect(preview).toBeVisible();
  const src = (await preview.getAttribute('src')) ?? '';
  const head = await page.evaluate(async (url) => {
    const bytes = new Uint8Array(await (await fetch(url)).arrayBuffer());
    return String.fromCharCode(...bytes.slice(0, 5));
  }, src);
  expect(head).toBe('%PDF-');
  await expect(page.getByRole('link', { name: 'Open the preview in a new tab' })).toBeVisible();

  // Step 11: the organization's Manager signs.
  await actions.getByRole('button', { name: 'Next' }).click();
  const signer = page.getByLabel('Signing Manager');
  const demoManager = signer.locator('option', { hasText: 'Demo Manager' });
  await signer.selectOption((await demoManager.getAttribute('value')) ?? '');
  await page.getByLabel('Identity document checked').fill('CCCD ending 1234');
  await drawSignature(page);
  await actions.getByRole('button', { name: 'Complete handover' }).click();
  await expectToast(page, `Handover complete. 5 devices issued under contract ${contractCode}.`);
  await expect(page.getByRole('heading', { name: `Handover of ${contractCode}` })).toBeVisible();
  await expect(page.getByText('5 devices issued. The contract is active and the signed note is stored.')).toBeVisible();

  // Step 12: the contract page and the signed note.
  await page.getByRole('link', { name: 'Open the contract and the handover note' }).click();
  await expect(page.getByText('Active').first()).toBeVisible();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download handover note' }).click();
  expect((await download).suggestedFilename()).toBe(`${contractCode}-handover-note.pdf`);
});

test('MF-01 steps 13 and 14: the Manager creates a Field Station credential', async ({ page }) => {
  await signIn(page, 'manager');
  await openFromSidebar(page, 'Field stations');
  await expect(page.getByText('Ta Nang basecamp laptop').filter({ visible: true }).first()).toBeVisible();
  // At five active stations Create is disabled (script step 14); a rehearsal without a reset can
  // reach it.
  const create = page.getByRole('button', { name: 'Create Field Station' });
  test.skip(await create.isDisabled(), 'ORG-0001 already holds five active Field Stations');
  await create.click();
  const dialog = page.getByRole('dialog', { name: 'Create Field Station' });
  await dialog.getByLabel('Name').fill('Phan Dung ranger post');
  await dialog.getByRole('button', { name: 'Create', exact: true }).click();

  const credential = page.getByRole('dialog', { name: 'Credential for Phan Dung ranger post' });
  await expect(credential).toBeVisible();
  await expect(credential.getByText(/^fs-org-0001-\d+$/)).toBeVisible();
  await expect(credential.getByText('Copy it now; it will not be shown again.')).toBeVisible();
  await credential.getByRole('button', { name: 'Done' }).click();

  // Step 14
  await expect(page.getByText(/^\d of 5 active stations/)).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: 'Phan Dung ranger post' }).last();
  await expect(row).toContainText('Not reported');
  await expect(row).toContainText('Never');
});
