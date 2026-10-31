const { chromium } = require('playwright');
const OUT = process.argv[2];
const PASSWORD = process.env.SEED_STAFF_PASSWORD;
const log = [];
const note = (step, data) => { log.push({ step, ...data }); console.log(JSON.stringify({ step, ...data })); };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  const failed = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => failed.push(`[on ${new URL(page.url()).pathname}] ${r.method()} ${r.url()} ${r.failure()?.errorText}`));
  page.on('response', async (r) => {
    if (r.status() >= 400) failed.push(`[on ${new URL(page.url()).pathname}] ${r.request().method()} ${r.url()} ${r.status()}`);
  });
  const shot = async (name) => page.screenshot({ path: `${OUT}/${name}.png`, fullPage: true });

  // 1. Sign in as Staff
  await page.goto('http://localhost:5173/sign-in');
  await page.fill('#sign-in-email', 'staff@treklink.local');
  await page.fill('#sign-in-password', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL((u) => !u.pathname.startsWith('/sign-in'), { timeout: 15000 });
  note('signed-in', { url: page.url() });

  // 2. Sidebar Field data sync
  await page.getByRole('link', { name: 'Field data sync' }).first().click();
  await page.waitForURL('**/t/admin/sync');
  await page.getByText('MQTT subscriber').waitFor();
  await page.getByRole('heading', { name: 'Sync audit' }).waitFor();
  await page.waitForSelector('table[aria-label], caption', { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const failedBeforeSyncSettled = failed.length;
  await shot('01-field-data-sync');
  await page.getByRole('heading', { name: 'Recent field events' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: `${OUT}/01b-recent-events.png` });
  await page.evaluate(() => document.getElementById('sync-audit-title').scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/01c-sync-audit.png` });
  await page.getByRole('heading', { name: 'Field data sync' }).scrollIntoViewIfNeeded();

  const cards = await page.evaluate(() => {
    const labels = ['MQTT subscriber', 'Accepted', 'Duplicates rejected', 'Malformed', 'Normalization failed', 'Unattributed', 'Unknown device'];
    const out = {};
    for (const el of document.querySelectorAll('main *')) {
      const t = el.childNodes.length === 1 && el.firstChild.nodeType === 3 ? el.textContent.trim() : null;
      if (t && labels.includes(t) && !(t in out)) {
        let card = el;
        while (card.parentElement && card.textContent.trim() === t) card = card.parentElement;
        out[t] = card.innerText.replace(/\n+/g, ' | ');
      }
    }
    return out;
  });
  note('cards', { cards });

  const tables = await page.evaluate(() => [...document.querySelectorAll('table')].map((t) => ({
    caption: t.caption?.innerText ?? null,
    headers: [...t.querySelectorAll('thead th')].map((th) => th.innerText.trim()),
    rows: [...t.querySelectorAll('tbody tr')].slice(0, 4).map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText.replace(/\n+/g, ' / ').trim())),
    rowCount: t.querySelectorAll('tbody tr').length,
  })));
  note('tables', { tables });
  const pager = await page.locator('nav[aria-label="Pages"]').innerText().catch(() => null);
  note('audit-pager', { pager });

  // 3. Window: Last 15 minutes, then Refresh
  const accepted = async () => page.evaluate(() => { const el = [...document.querySelectorAll('main *')].find((x) => x.childNodes.length === 1 && x.textContent.trim() === 'Accepted'); let c = el; while (c.parentElement && c.textContent.trim() === 'Accepted') c = c.parentElement; return c.innerText.replace(/\n+/g, ' | '); });
  const before = await accepted();
  const windowSelect = page.locator('label:has-text("Window") select');
  await windowSelect.selectOption('15');
  await page.waitForTimeout(1500);
  const after15 = await accepted();
  await shot('02-window-15-minutes');
  await page.waitForTimeout(6000);
  const statusReq = page.waitForResponse((r) => r.url().endsWith('/api/gateway-sync') && r.request().postData()?.includes('syncStatus'));
  const auditReq = page.waitForResponse((r) => r.url().endsWith('/api/gateway-sync') && r.request().postData()?.includes('listAudit'));
  await page.getByRole('button', { name: 'Refresh' }).click();
  const [s, a] = await Promise.all([statusReq, auditReq]);
  await page.waitForTimeout(800);
  const afterRefresh = await accepted();
  note('window-refresh', { before, after15, afterRefresh, statusCode: s.status(), auditCode: a.status(), statusBody: s.request().postData() });
  await shot('03-after-refresh');

  // 4. Outcome filter: Malformed
  await page.locator('#sync-audit-outcome').selectOption('MALFORMED_ENVELOPE');
  await page.waitForResponse((r) => r.request().postData()?.includes('MALFORMED_ENVELOPE'));
  await page.waitForTimeout(800);
  const malformed = await page.evaluate(() => {
    const t = [...document.querySelectorAll('table')].find((x) => x.caption?.innerText.includes('Sync audit'));
    const code = t?.querySelector('tbody code');
    const text = code?.getAttribute('title') ?? '';
    return {
      rows: t ? [...t.querySelectorAll('tbody tr')].map((tr) => tr.innerText.replace(/\n+/g, ' / ').slice(0, 160)) : null,
      excerptCodePoints: [...text].length,
      excerptUtf16: text.length,
      loneSurrogate: /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text),
      cutNotice: !!t && t.innerText.includes('Raw payload cut by the server.'),
    };
  });
  note('filter-malformed', malformed);
  await page.locator('section[aria-labelledby="sync-audit-title"]').screenshot({ path: `${OUT}/04-outcome-malformed.png` });

  // 5. Back to every outcome, Page 2
  await page.locator('#sync-audit-outcome').selectOption('');
  await page.waitForTimeout(1200);
  const firstIdPage1 = await page.locator('table:has(caption:has-text("Sync audit")) tbody tr').first().innerText();
  const p2 = page.waitForResponse((r) => r.request().postData()?.includes('"pageNumber":2'));
  await page.getByRole('button', { name: 'Page 2' }).click();
  const p2r = await p2;
  await page.waitForTimeout(800);
  const pagerP2 = await page.locator('nav[aria-label="Pages"]').innerText();
  const firstIdPage2 = await page.locator('table:has(caption:has-text("Sync audit")) tbody tr').first().innerText();
  const rowsP2 = await page.locator('table:has(caption:has-text("Sync audit")) tbody tr').count();
  note('page-2', { status: p2r.status(), body: p2r.request().postData(), pagerP2: pagerP2.replace(/\n+/g, ' '), rowsP2, firstPage1: firstIdPage1.replace(/\n+/g, ' / '), firstPage2: firstIdPage2.replace(/\n+/g, ' / ') });
  await page.evaluate(() => document.querySelector('nav[aria-label="Pages"]').scrollIntoView({ block: 'end' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/05-audit-page-2.png` });

  note('console', { consoleErrors });
  note('failed-requests', { beforeSyncPageSettled: failed.slice(0, failedBeforeSyncSettled), afterSyncPageSettled: failed.slice(failedBeforeSyncSettled) });
  require('fs').writeFileSync(`${OUT}/walk-log.json`, JSON.stringify(log, null, 2));
  await browser.close();
})().catch((e) => { console.error('WALK FAILED', e); process.exit(1); });
