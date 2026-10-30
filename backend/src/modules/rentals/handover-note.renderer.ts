import * as PDFDocument from 'pdfkit';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// What the handover record states (rentals task 2.4, design §4.1, FR-CON-06, D-037). Every value is
// given by the caller: the issuer from configuration, the rest from the rentals, organizations,
// billing and devices reads and the business parameters. The renderer only lays it out, and prints
// "Not recorded" for an optional value that is absent. Fields are added, never repurposed, so a
// caller that sends more (counter readings on the preview, for example) keeps older callers valid.

export interface NoteIssuer {
  legalName: string;
  address: string;
  taxCode: string;
  hotline: string;
}

export interface NotePartyA {
  // The Staff or Admin account at the counter; null when the directory does not name it.
  name: string | null;
  role: string;
}

export interface NotePartyB {
  legalName: string;
  code: string;
  taxCode: string | null;
  address: string | null;
  // The signing Manager and the identity document Staff saw; null on the preview.
  manager: { fullName: string; identityDocument: string } | null;
}

export interface NoteContract {
  code: string;
  planLabel: string;
  variantCode: string;
  quantity: number;
  termStart: Date | null;
  termEnd: Date | null;
  // Null for a monthly contract before notice: the return falls due at the end of the notice term.
  returnDue: Date | null;
  monthlyUnitPriceVnd: bigint;
  fee: { label: string; amountVnd: bigint };
  firstPayment: { label: string; amountVnd: bigint };
  masterContractRef: string | null;
  ndaSigned: boolean;
  softwareLicenceSigned: boolean;
}

export interface NoteDevice {
  assetTag: string;
  variantCode: string;
  nodeId?: string | null;
  keyVersion?: number | null;
  // Counter readings: null or absent until Staff check the unit.
  batteryPct?: number | null;
  gpsFixOk?: boolean | null;
  condition?: string | null;
  // What a confirmed loss would charge at the note's time (FR-BILL-05).
  remainingValueVnd?: number | null;
}

export interface NotePayment {
  invoiceNumber: string;
  amountVnd: bigint;
  method: string;
  reference: string;
  receivedAt: Date | null;
}

export interface NoteTerms {
  lateFeePerDevicePerDayVnd: number;
  returnGraceHours: number;
  defaultAfterDays: number;
  lossSearchDays: number;
  damageRates: { code: string; label: string; amountVnd: bigint }[];
}

export interface HandoverNoteInput {
  // A replacement on a running contract (rentals 4.3) prints its own title and the unit it replaces.
  kind?: 'HANDOVER' | 'REPLACEMENT';
  noteNumber: string;
  at: Date;
  place: string;
  issuer: NoteIssuer;
  partyA: NotePartyA;
  partyB: NotePartyB;
  contract: NoteContract;
  devices: NoteDevice[];
  payments: NotePayment[];
  firstPaymentConfirmed: boolean;
  terms: NoteTerms;
  signaturePng?: Buffer;
  replaces?: { assetTag: string; how: string };
}

const ZONE = 'Asia/Ho_Chi_Minh';
const NOT_RECORDED = 'Not recorded';

const PAGE_MARGIN = 50;
const FOOTER_SPACE = 36;
const CELL_PAD = 4;
const BLACK = '#000000';

const stamp = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' }) +
  ' (UTC+7)';

const vnd = (amount: bigint | number) => `${BigInt(amount).toLocaleString('en-US')} VND`;

const orNot = (value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === '' ? NOT_RECORDED : value;

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Cash',
  BANK_TRANSFER: 'Bank transfer',
  SEPAY: 'SePay transfer',
};

// Only the last four digits of a document number are printed, whatever the counter typed.
// Every digit but the last four is masked, across spaces and dashes, so "079 203 001 234" and
// "079-203-001-234" print as safely as "079203001234"; four digits or fewer are left as written.
export const maskIdentity = (recorded: string): string => {
  const total = (recorded.match(/\d/g) ?? []).length;
  if (total <= 4) return recorded;
  let seen = 0;
  return recorded.replace(/\d/g, (digit) => (++seen <= total - 4 ? '*' : digit));
};

const battery = (device: NoteDevice) =>
  device.batteryPct === null || device.batteryPct === undefined
    ? 'Not checked'
    : `${device.batteryPct} %`;

const gps = (device: NoteDevice) =>
  device.gpsFixOk === null || device.gpsFixOk === undefined
    ? 'Not checked'
    : device.gpsFixOk
      ? 'Fix OK'
      : 'No fix';

const lossRate = (devices: readonly NoteDevice[]): string => {
  const values = devices
    .map((device) => device.remainingValueVnd)
    .filter((value): value is number => typeof value === 'number');
  if (values.length === 0) return 'Remaining value of the unit by age';
  const low = Math.min(...values);
  const high = Math.max(...values);
  return low === high
    ? `${vnd(low)} per unit at this date`
    : `${vnd(low)} to ${vnd(high)} per unit at this date, by age`;
};

// The bundled Unicode font, read from disk on the first note and kept for the process's lifetime.
let fontData: Buffer | undefined;
const unicodeFont = (): Buffer =>
  (fontData ??= readFileSync(join(__dirname, 'assets', 'DejaVuSans.ttf')));

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right' | 'center';
}

// Lays the record out on A4 pages, black on white, in the bundled DejaVu Sans so organization and
// signer names keep their Vietnamese diacritics. Tables break across pages with their header row
// repeated; every page carries the note number and "Page x of y".
class NoteLayout {
  readonly left = PAGE_MARGIN;
  readonly width: number;

  constructor(private readonly doc: PDFKit.PDFDocument) {
    this.width = doc.page.width - 2 * PAGE_MARGIN;
  }

  private get bottom() {
    return this.doc.page.height - PAGE_MARGIN - FOOTER_SPACE;
  }

  ensure(height: number) {
    if (this.doc.y + height > this.bottom) {
      this.doc.addPage();
      this.doc.y = PAGE_MARGIN;
    }
  }

  rule(weight = 0.75) {
    const y = this.doc.y;
    this.doc
      .lineWidth(weight)
      .moveTo(this.left, y)
      .lineTo(this.left + this.width, y)
      .stroke(BLACK);
  }

  heading(text: string) {
    // The heading keeps at least a few lines of its section with it.
    this.ensure(80);
    this.doc.moveDown(0.8).fontSize(11).fillColor(BLACK);
    this.doc.text(text.toUpperCase(), this.left, this.doc.y, { width: this.width });
    this.doc.moveDown(0.15);
    this.rule(0.5);
    this.doc.moveDown(0.35);
  }

  paragraph(text: string, size = 9.5) {
    this.doc.fontSize(size);
    this.ensure(this.doc.heightOfString(text, { width: this.width }) + 4);
    this.doc.text(text, this.left, this.doc.y, { width: this.width, align: 'justify' });
    this.doc.moveDown(0.3);
  }

  // Label and value rows, bordered, the label column a fixed width.
  facts(rows: [string, string][], labelWidth = 150) {
    this.table(
      [
        { header: '', width: labelWidth },
        { header: '', width: this.width - labelWidth },
      ],
      rows,
      { header: false },
    );
  }

  // Two label and value tables next to each other, kept on one page.
  factsSideBySide(left: [string, string][], right: [string, string][], labelWidth = 84) {
    const gap = 12;
    const half = (this.width - gap) / 2;
    const columns = [
      { header: '', width: labelWidth },
      { header: '', width: half - labelWidth },
    ];
    const size = 8.5;
    this.doc.fontSize(size);
    const heightOfRows = (rows: [string, string][]) =>
      rows.reduce(
        (total, row) =>
          total +
          Math.max(
            ...row.map((cell, index) =>
              this.doc.heightOfString(cell, { width: columns[index].width - 2 * CELL_PAD }),
            ),
          ) +
          2 * CELL_PAD,
        0,
      );
    this.ensure(Math.max(heightOfRows(left), heightOfRows(right)) + 8);
    const top = this.doc.y;
    this.table(columns, left, { header: false, size, x: this.left });
    const leftEnd = this.doc.y;
    this.doc.y = top;
    this.table(columns, right, { header: false, size, x: this.left + half + gap });
    this.doc.x = this.left;
    this.doc.y = Math.max(leftEnd, this.doc.y);
  }

  table(
    columns: Column[],
    rows: string[][],
    options: { header?: boolean; size?: number; x?: number } = {},
  ) {
    const size = options.size ?? 9;
    const header = options.header ?? true;
    const left = options.x ?? this.left;
    const heightOf = (cells: string[], fontSize: number) => {
      this.doc.fontSize(fontSize);
      return (
        Math.max(
          ...cells.map((cell, index) =>
            this.doc.heightOfString(cell, { width: columns[index].width - 2 * CELL_PAD }),
          ),
        ) +
        2 * CELL_PAD
      );
    };
    const draw = (cells: string[], fontSize: number, height: number) => {
      const y = this.doc.y;
      let x = left;
      this.doc.fontSize(fontSize).fillColor(BLACK).lineWidth(0.5);
      cells.forEach((cell, index) => {
        const column = columns[index];
        this.doc.rect(x, y, column.width, height).stroke(BLACK);
        this.doc.text(cell, x + CELL_PAD, y + CELL_PAD, {
          width: column.width - 2 * CELL_PAD,
          align: column.align ?? 'left',
        });
        x += column.width;
      });
      this.doc.x = this.left;
      this.doc.y = y + height;
    };
    const headerCells = columns.map((column) => column.header);
    const drawHeader = () => {
      if (header) draw(headerCells, size - 0.5, heightOf(headerCells, size - 0.5));
    };

    // A header row never stands alone at the foot of a page.
    this.ensure(
      (header ? heightOf(headerCells, size - 0.5) : 0) + (rows[0] ? heightOf(rows[0], size) : 0),
    );
    drawHeader();
    for (const row of rows) {
      const height = heightOf(row, size);
      if (this.doc.y + height > this.bottom) {
        this.doc.addPage();
        this.doc.y = PAGE_MARGIN;
        drawHeader();
      }
      draw(row, size, height);
    }
    this.doc.moveDown(0.4);
  }
}

const letterhead = (doc: PDFKit.PDFDocument, layout: NoteLayout, input: HandoverNoteInput) => {
  const top = PAGE_MARGIN;
  const leftWidth = layout.width * 0.58;
  const rightX = layout.left + leftWidth + 12;
  const rightWidth = layout.width - leftWidth - 12;

  doc.fillColor(BLACK).fontSize(13);
  doc.text(input.issuer.legalName, layout.left, top, { width: leftWidth });
  doc.fontSize(8.5);
  doc.text(input.issuer.address, { width: leftWidth });
  doc.text(`Tax code: ${input.issuer.taxCode}`, { width: leftWidth });
  doc.text(`Hotline: ${input.issuer.hotline}`, { width: leftWidth });
  const leftEnd = doc.y;

  doc.fontSize(8.5);
  doc.text(`Note No.: ${input.noteNumber}`, rightX, top + 2, { width: rightWidth, align: 'right' });
  doc.text(`Date: ${stamp(input.at)}`, { width: rightWidth, align: 'right' });
  doc.text(`Place: ${input.place}`, { width: rightWidth, align: 'right' });
  doc.y = Math.max(leftEnd, doc.y) + 6;
  layout.rule(1.25);
  doc.moveDown(0.15);
  layout.rule(0.4);
  doc.moveDown(1);

  const replacement = input.kind === 'REPLACEMENT';
  doc.fontSize(16);
  doc.text(
    replacement ? 'DEVICE REPLACEMENT RECORD' : 'DEVICE HANDOVER RECORD',
    layout.left,
    doc.y,
    {
      width: layout.width,
      align: 'center',
    },
  );
  doc.moveDown(0.2).fontSize(9.5);
  doc.text(`Rental contract ${input.contract.code}`, { width: layout.width, align: 'center' });
  if (!input.signaturePng) {
    doc.moveDown(0.2);
    doc.text('PREVIEW FOR REVIEW BEFORE SIGNING. NOT A SIGNED RECORD.', {
      width: layout.width,
      align: 'center',
    });
  }
  doc.moveDown(0.8);
  layout.paragraph(
    `This record is made at ${input.place} on ${stamp(input.at)} between the two parties below, ` +
      `under rental contract ${input.contract.code}` +
      (input.contract.masterContractRef
        ? ` and master contract ${input.contract.masterContractRef}.`
        : '.'),
  );
};

const parties = (layout: NoteLayout, input: HandoverNoteInput) => {
  layout.heading('1. The parties');
  const manager = input.partyB.manager;
  layout.factsSideBySide(
    [
      ['Party A (lessor)', input.issuer.legalName],
      ['Address', input.issuer.address],
      ['Tax code', input.issuer.taxCode],
      ['Hotline', input.issuer.hotline],
      ['Represented by', orNot(input.partyA.name)],
      ['Role', input.partyA.role],
    ],
    [
      ['Party B (lessee)', input.partyB.legalName],
      ['Organization code', input.partyB.code],
      ['Tax code', orNot(input.partyB.taxCode)],
      ['Address', orNot(input.partyB.address)],
      [
        'Represented by',
        manager
          ? `${manager.fullName}, Org Manager`
          : input.signaturePng
            ? 'The Org Manager who signs below'
            : 'Chosen at signing',
      ],
      [
        'Identity document',
        manager
          ? maskIdentity(manager.identityDocument)
          : input.signaturePng
            ? NOT_RECORDED
            : 'Recorded at signing',
      ],
    ],
  );
};

const contractReference = (layout: NoteLayout, input: HandoverNoteInput) => {
  const contract = input.contract;
  layout.heading('2. Contract reference');
  const term =
    contract.termStart && contract.termEnd
      ? `${stamp(contract.termStart)} to ${stamp(contract.termEnd)}`
      : NOT_RECORDED;
  layout.facts([
    ['Contract code', contract.code],
    ['Plan', contract.planLabel],
    ['Hardware variant and quantity', `${contract.variantCode}, ${contract.quantity} units`],
    ['First term', term],
    [
      'Return due',
      contract.returnDue
        ? stamp(contract.returnDue)
        : 'At the end of the term in which notice is given',
    ],
    ['Monthly unit price', vnd(contract.monthlyUnitPriceVnd)],
    [contract.fee.label, vnd(contract.fee.amountVnd)],
    [contract.firstPayment.label, vnd(contract.firstPayment.amountVnd)],
    ['Master contract No.', orNot(contract.masterContractRef)],
    [
      'Non-disclosure agreement',
      contract.ndaSigned ? 'Signed, part of the master contract' : 'Not signed',
    ],
    [
      'Field Station software licence',
      contract.softwareLicenceSigned ? 'Signed, part of the master contract' : 'Not signed',
    ],
  ]);
};

const deviceTable = (layout: NoteLayout, input: HandoverNoteInput) => {
  const replacement = input.kind === 'REPLACEMENT';
  layout.heading(replacement ? '3. Device handed over as a replacement' : '3. Devices handed over');
  const widths = [24, 56, 64, 62, 40, 46, 46];
  const fixed = widths.reduce((total, width) => total + width, 0);
  layout.table(
    [
      { header: 'No.', width: widths[0], align: 'center' },
      { header: 'Asset tag', width: widths[1] },
      { header: 'Variant', width: widths[2] },
      { header: 'Node ID', width: widths[3] },
      { header: 'Key ver.', width: widths[4], align: 'center' },
      { header: 'Battery', width: widths[5], align: 'right' },
      { header: 'GPS fix', width: widths[6] },
      { header: 'Condition', width: layout.width - fixed },
    ],
    input.devices.map((device, index) => [
      String(index + 1),
      device.assetTag,
      device.variantCode,
      orNot(device.nodeId),
      device.keyVersion === null || device.keyVersion === undefined ? '-' : `v${device.keyVersion}`,
      battery(device),
      gps(device),
      orNot(device.condition),
    ]),
  );
  if (input.replaces) {
    layout.paragraph(`This unit replaces ${input.replaces.assetTag}, ${input.replaces.how}.`);
  }
  layout.paragraph(
    `Total: ${input.devices.length} ${input.devices.length === 1 ? 'unit' : 'units'}. Each unit ` +
      "carries Party B's channel key at the version shown; TrekLink keeps the version only, never the key.",
    8.5,
  );
};

const paymentSection = (layout: NoteLayout, input: HandoverNoteInput) => {
  layout.heading('4. Payment received before handover');
  if (input.payments.length === 0) {
    layout.paragraph('No payment is recorded on this contract yet.');
  } else {
    layout.table(
      [
        { header: 'Invoice No.', width: 100 },
        { header: 'Amount', width: 100, align: 'right' },
        { header: 'Method', width: 80 },
        { header: 'Receipt or reference', width: 120 },
        { header: 'Received', width: layout.width - 400 },
      ],
      input.payments.map((payment) => [
        payment.invoiceNumber,
        vnd(payment.amountVnd),
        METHOD_LABELS[payment.method] ?? payment.method,
        payment.reference,
        payment.receivedAt ? stamp(payment.receivedAt) : NOT_RECORDED,
      ]),
    );
  }
  layout.paragraph(
    input.firstPaymentConfirmed
      ? `The ${input.contract.firstPayment.label.toLowerCase()} is paid in full, as the handover requires.`
      : `The ${input.contract.firstPayment.label.toLowerCase()} is not paid in full yet; the handover cannot be signed until it is.`,
  );
};

const termsSection = (layout: NoteLayout, input: HandoverNoteInput) => {
  const terms = input.terms;
  layout.heading('5. Custody, damage and loss');
  layout.paragraph(
    '5.1 Custody. Each device in section 3 is in the custody of Party B from the time of this ' +
      'record until it is checked in at a TrekLink counter, and Party B is responsible for it ' +
      'during that time.',
  );
  layout.paragraph(
    `5.2 Return. The devices are returned by the return due date in section 2. A unit checked in ` +
      `more than ${terms.returnGraceHours} hours after that time is charged the late fee below for ` +
      `every started day after the due time. A contract still overdue after ` +
      `${terms.defaultAfterDays} days is in default, and Party B's account is suspended.`,
  );
  layout.paragraph(
    '5.3 Damage. Each unit is inspected at check-in. Each damage found is charged at the rate ' +
      'below for its code, on the closing invoice.',
  );
  layout.paragraph(
    `5.4 Loss. Party B reports a missing unit at once. TrekLink searches for it for ` +
      `${terms.lossSearchDays} days; a loss confirmed while the unit is in Party B's custody is ` +
      "charged the unit's remaining value by age.",
  );
  layout.paragraph('5.5 TrekLink is not a search-and-rescue provider.');
  layout.table(
    [
      { header: 'Charge', width: layout.width - 180 },
      { header: 'Rate', width: 180, align: 'right' },
    ],
    [
      ['Late return, per unit per started day', vnd(terms.lateFeePerDevicePerDayVnd)],
      ...terms.damageRates.map((rate) => [
        `Damage: ${rate.label} (${rate.code})`,
        vnd(rate.amountVnd),
      ]),
      ['Loss of a unit, remaining value', lossRate(input.devices)],
    ],
  );
};

const signatures = (doc: PDFKit.PDFDocument, layout: NoteLayout, input: HandoverNoteInput) => {
  layout.heading('6. Acceptance and signatures');
  layout.paragraph(
    'Party B has checked the devices in section 3, received them in the condition stated, and ' +
      'accepts the terms in section 5. TrekLink keeps the SHA-256 digest of the signed file to ' +
      'verify this record later.',
  );
  const gap = 16;
  const boxWidth = (layout.width - gap) / 2;
  const boxHeight = 168;
  layout.ensure(boxHeight + 8);
  const top = doc.y + 4;
  const signed = input.signaturePng !== undefined;
  const manager = input.partyB.manager;
  const blocks = [
    {
      x: layout.left,
      title: 'PARTY A, FOR THE LESSOR',
      organization: input.issuer.legalName,
      name: orNot(input.partyA.name),
      role: input.partyA.role,
      image: undefined as Buffer | undefined,
    },
    {
      x: layout.left + boxWidth + gap,
      title: 'PARTY B, FOR THE LESSEE',
      organization: input.partyB.legalName,
      name: manager ? manager.fullName : signed ? NOT_RECORDED : 'Chosen at signing',
      role: 'Org Manager',
      image: input.signaturePng,
    },
  ];
  for (const block of blocks) {
    const inner = boxWidth - 2 * 8;
    doc.lineWidth(0.75).rect(block.x, top, boxWidth, boxHeight).stroke(BLACK);
    doc.fillColor(BLACK).fontSize(9.5);
    doc.text(block.title, block.x + 8, top + 8, { width: inner, align: 'center' });
    doc.fontSize(8.5).text(block.organization, { width: inner, align: 'center' });
    const lineY = top + 112;
    if (block.image) {
      doc.image(block.image, block.x + 8, top + 40, {
        fit: [inner, 68],
        align: 'center',
        valign: 'center',
      });
    }
    doc
      .lineWidth(0.5)
      .moveTo(block.x + 16, lineY)
      .lineTo(block.x + boxWidth - 16, lineY)
      .stroke(BLACK);
    doc.fontSize(8.5);
    doc.text(`Name: ${block.name}`, block.x + 8, lineY + 6, { width: inner });
    doc.text(`Role: ${block.role}`, { width: inner });
    doc.text(`Time: ${signed ? stamp(input.at) : 'Not signed'}`, { width: inner });
  }
  doc.x = layout.left;
  doc.y = top + boxHeight + 8;
};

const footers = (doc: PDFKit.PDFDocument, input: HandoverNoteInput) => {
  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const bottomMargin = doc.page.margins.bottom;
    // Writing inside the bottom margin would otherwise start a new page.
    doc.page.margins.bottom = 0;
    const y = doc.page.height - PAGE_MARGIN - 12;
    const width = doc.page.width - 2 * PAGE_MARGIN;
    doc
      .lineWidth(0.4)
      .moveTo(PAGE_MARGIN, y - 6)
      .lineTo(PAGE_MARGIN + width, y - 6)
      .stroke(BLACK);
    doc.fillColor(BLACK).fontSize(8);
    doc.text(`${input.issuer.legalName}, note ${input.noteNumber}`, PAGE_MARGIN, y, {
      width: width * 0.7,
      lineBreak: false,
    });
    doc.text(`Page ${index - range.start + 1} of ${range.count}`, PAGE_MARGIN, y, {
      width,
      align: 'right',
      lineBreak: false,
    });
    doc.page.margins.bottom = bottomMargin;
  }
};

export const renderHandoverNote = (input: HandoverNoteInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: PAGE_MARGIN,
      bufferPages: true,
      info: {
        Title: `${input.kind === 'REPLACEMENT' ? 'Device replacement record' : 'Device handover record'} ${input.noteNumber}`,
        Author: input.issuer.legalName,
        Subject: `Rental contract ${input.contract.code}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.font(unicodeFont());

    const layout = new NoteLayout(doc);
    letterhead(doc, layout, input);
    parties(layout, input);
    contractReference(layout, input);
    deviceTable(layout, input);
    paymentSection(layout, input);
    termsSection(layout, input);
    signatures(doc, layout, input);
    footers(doc, input);
    doc.end();
  });
