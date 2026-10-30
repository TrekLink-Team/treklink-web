import * as fs from 'node:fs';
import { maskIdentity, renderHandoverNote, type HandoverNoteInput } from './handover-note.renderer';

// The library entry point, not the package index: the index reads a sample PDF when it has no parent
// module, which is the case under Jest.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require('pdf-parse/lib/pdf-parse.js') as typeof import('pdf-parse');

// A 1 x 1 PNG, as the signature pad sends it.
const SIGNATURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

const AT = new Date('2026-11-02T03:00:00.000Z');

// Every section filled, as a signed handover after a counter payment.
const fullNote = (): HandoverNoteInput => ({
  kind: 'HANDOVER',
  noteNumber: 'HN-2026-0001',
  at: AT,
  place: 'TrekLink counter, District 1',
  issuer: {
    legalName: 'Công ty TNHH TrekLink',
    address: '7 Hàn Thuyên, Ho Chi Minh City',
    taxCode: '0312345678',
    hotline: '1900 1234',
  },
  partyA: { name: 'Trần Thị Bích', role: 'TrekLink Staff' },
  partyB: {
    legalName: 'Nguyễn Đặng Trekking',
    code: 'ORG-0001',
    taxCode: '0109876543',
    address: '12 Lê Lợi, Đà Lạt',
    manager: { fullName: 'Lâm Phi Long', identityDocument: 'CCCD 079203001234' },
  },
  contract: {
    code: 'RC-2026-0001',
    planLabel: 'Monthly',
    variantCode: 'treklink-v3',
    quantity: 2,
    termStart: new Date('2026-11-02T02:00:00.000Z'),
    termEnd: new Date('2026-12-02T02:00:00.000Z'),
    returnDue: new Date('2026-12-02T02:00:00.000Z'),
    monthlyUnitPriceVnd: 450_000n,
    fee: { label: 'Term fee, per month', amountVnd: 900_000n },
    firstPayment: { label: 'Holding fee', amountVnd: 450_000n },
    masterContractRef: 'MC-2026-017',
    ndaSigned: true,
    softwareLicenceSigned: true,
  },
  devices: [
    {
      assetTag: 'TL-0001',
      variantCode: 'treklink-v3',
      nodeId: '!de000001',
      keyVersion: 2,
      batteryPct: 87,
      gpsFixOk: true,
      condition: 'Good working order',
      remainingValueVnd: 2_500_000,
    },
    {
      assetTag: 'TL-0002',
      variantCode: 'treklink-v3',
      nodeId: '!de000002',
      keyVersion: 2,
      batteryPct: 15,
      gpsFixOk: true,
      condition: 'Working order; battery below 20 %, accepted',
      remainingValueVnd: 1_800_000,
    },
  ],
  payments: [
    {
      invoiceNumber: 'INV-2026-000001',
      amountVnd: 450_000n,
      method: 'CASH',
      reference: 'RCPT-0042',
      receivedAt: new Date('2026-11-02T02:30:00.000Z'),
    },
  ],
  firstPaymentConfirmed: true,
  terms: {
    lateFeePerDevicePerDayVnd: 50_000,
    returnGraceHours: 24,
    defaultAfterDays: 14,
    lossSearchDays: 7,
    damageRates: [{ code: 'CASING_CRACKED', label: 'Casing cracked', amountVnd: 300_000n }],
  },
  signaturePng: SIGNATURE,
});

// The PDF's text layer with its whitespace collapsed, so a value wrapped in a cell still matches.
const textOf = async (pdf: Buffer) => {
  const parsed = await pdfParse(pdf);
  return { text: parsed.text.replace(/\s+/g, ' '), pages: parsed.numpages };
};

describe('renderHandoverNote (rentals task 2.4, design §4.1)', () => {
  it('prints every section of the formal record in the text layer', async () => {
    const pdf = await renderHandoverNote(fullNote());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const { text, pages } = await textOf(pdf);

    // Letterhead: issuer identity, note number, date and place.
    for (const value of [
      'Công ty TNHH TrekLink',
      '7 Hàn Thuyên, Ho Chi Minh City',
      'Tax code: 0312345678',
      'Hotline: 1900 1234',
      'Note No.: HN-2026-0001',
      'Place: TrekLink counter, District 1',
      'DEVICE HANDOVER RECORD',
    ]) {
      expect(text).toContain(value);
    }
    expect(text).toMatch(/Date: 2 Nov 2026, 10:00 \(UTC\+7\)/);
    expect(text).not.toContain('PREVIEW');

    // Parties, with only the last four digits of the identity document.
    for (const value of [
      '1. THE PARTIES',
      'Trần Thị Bích',
      'TrekLink Staff',
      'Nguyễn Đặng Trekking',
      'ORG-0001',
      '0109876543',
      '12 Lê Lợi, Đà Lạt',
      'Lâm Phi Long, Org Manager',
      'CCCD ********1234',
    ]) {
      expect(text).toContain(value);
    }
    expect(text).not.toContain('079203001234');

    // Contract reference with prices and the master contract.
    for (const value of [
      '2. CONTRACT REFERENCE',
      'RC-2026-0001',
      'treklink-v3, 2 units',
      '2 Nov 2026, 09:00 (UTC+7) to 2 Dec 2026, 09:00 (UTC+7)',
      '450,000 VND',
      '900,000 VND',
      'MC-2026-017',
      'Signed, part of the master contract',
    ]) {
      expect(text).toContain(value);
    }

    // Device table.
    for (const value of [
      '3. DEVICES HANDED OVER',
      'TL-0001',
      'TL-0002',
      '!de000001',
      'v2',
      '87 %',
      '15 %',
      'Fix OK',
      'Good working order',
    ]) {
      expect(text).toContain(value);
    }

    // Payment received before handover.
    for (const value of [
      '4. PAYMENT RECEIVED BEFORE HANDOVER',
      'INV-2026-000001',
      'Cash',
      'RCPT-0042',
      'The holding fee is paid in full',
    ]) {
      expect(text).toContain(value);
    }

    // Terms with the rate table, every number from the input.
    for (const value of [
      '5. CUSTODY, DAMAGE AND LOSS',
      'more than 24 hours after',
      'after 14 days',
      'for 7 days',
      '50,000 VND',
      'Damage: Casing cracked (CASING_CRACKED)',
      '300,000 VND',
      '1,800,000 VND to 2,500,000 VND per unit at this date, by age',
      'TrekLink is not a search',
    ]) {
      expect(text).toContain(value);
    }

    // Two signature blocks and the page footer.
    for (const value of [
      '6. ACCEPTANCE AND SIGNATURES',
      'PARTY A, FOR THE LESSOR',
      'PARTY B, FOR THE LESSEE',
      'Name: Trần Thị Bích',
      'Name: Lâm Phi Long',
      'Time: 2 Nov 2026, 10:00 (UTC+7)',
      'note HN-2026-0001',
      `Page 1 of ${pages}`,
      `Page ${pages} of ${pages}`,
    ]) {
      expect(text).toContain(value);
    }
  });

  it('marks the preview and prints "Not recorded" for a missing optional value', async () => {
    const note = fullNote();
    const pdf = await renderHandoverNote({
      ...note,
      signaturePng: undefined,
      partyA: { name: null, role: 'TrekLink Staff' },
      partyB: { ...note.partyB, taxCode: null, address: null, manager: null },
      contract: { ...note.contract, returnDue: null, masterContractRef: null, ndaSigned: false },
      devices: [{ assetTag: 'TL-0003', variantCode: 'treklink-v3' }],
      payments: [],
      firstPaymentConfirmed: false,
      terms: { ...note.terms, damageRates: [] },
    });
    const { text } = await textOf(pdf);

    expect(text).toContain('PREVIEW FOR REVIEW BEFORE SIGNING. NOT A SIGNED RECORD.');
    expect(text).toContain('Not recorded');
    expect(text).toContain('Chosen at signing');
    expect(text).toContain('At the end of the term in which notice is given');
    expect(text).toContain('Not checked');
    expect(text).toContain('No payment is recorded on this contract yet.');
    expect(text).toContain('is not paid in full yet');
    expect(text).toContain('Remaining value of the unit by age');
    expect(text).toContain('Time: Not signed');
    expect(text).not.toContain('MC-2026-017');
  });

  it('titles a replacement and names the unit it replaces', async () => {
    const note = fullNote();
    const { text } = await textOf(
      await renderHandoverNote({
        ...note,
        kind: 'REPLACEMENT',
        noteNumber: 'RN-2026-0001-TL-0012',
        partyB: { ...note.partyB, manager: null },
        devices: [note.devices[0]],
        replaces: { assetTag: 'TL-0004', how: 'checked in at the counter' },
      }),
    );
    expect(text).toContain('DEVICE REPLACEMENT RECORD');
    expect(text).toContain('3. DEVICE HANDED OVER AS A REPLACEMENT');
    expect(text).toContain('This unit replaces TL-0004, checked in at the counter.');
    expect(text).toContain('The Org Manager who signs below');
  });

  it('breaks a long device table across A4 pages and numbers every page', async () => {
    const note = fullNote();
    const devices = Array.from({ length: 40 }, (_, index) => ({
      ...note.devices[0],
      assetTag: `TL-${String(index + 1).padStart(4, '0')}`,
    }));
    const pdf = await renderHandoverNote({ ...note, devices });
    const { text, pages } = await textOf(pdf);
    expect(pages).toBeGreaterThan(2);
    expect(text).toContain('TL-0040');
    expect(text).toContain(`Page ${pages} of ${pages}`);
    // A4 in points.
    expect(pdf.toString('latin1')).toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('masks every digit of a document number but the last four', () => {
    expect(maskIdentity('CCCD 079203001234')).toBe('CCCD ********1234');
    expect(maskIdentity('CCCD ending 1234')).toBe('CCCD ending 1234');
    expect(maskIdentity('CCCD 079 203 001 234')).toBe('CCCD *** *** **1 234');
    expect(maskIdentity('079-203-001-234')).toBe('***-***-**1-234');
  });

  it('embeds a font and Unicode mapping for Vietnamese names', async () => {
    const contents = (await renderHandoverNote(fullNote())).toString('latin1');
    expect(contents).toContain('/FontFile2');
    expect(contents).toContain('/ToUnicode');
  });

  it('reads the font file once and reuses it for later notes', async () => {
    const read = jest.spyOn(fs, 'readFileSync');
    let render!: (input: HandoverNoteInput) => Promise<Buffer>;
    jest.isolateModules(() => {
      // A fresh module, so its font cache starts empty.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      render = (require('./handover-note.renderer') as typeof import('./handover-note.renderer'))
        .renderHandoverNote;
    });
    await render(fullNote());
    await render(fullNote());
    const fontReads = read.mock.calls.filter(([path]) => String(path).endsWith('DejaVuSans.ttf'));
    expect(fontReads).toHaveLength(1);
    read.mockRestore();
  });
});
