import * as PDFDocument from 'pdfkit';

// What the handover note states (rentals task 2.4, FR-CON-06, D-037). The preview has no signature,
// signer or identity yet; the stored note has all three.
export interface HandoverNoteInput {
  contractCode: string;
  organization: { code: string; legalName: string };
  planLabel: string;
  variantCode: string;
  requestedStartDate: string;
  devices: { assetTag: string; batteryPct: number | null; gpsFixOk: boolean | null }[];
  firstPaymentConfirmed: boolean;
  signer?: { fullName: string; identityChecked: string };
  signaturePng?: Buffer;
  at: Date;
}

const ZONE = 'Asia/Ho_Chi_Minh';

const stamp = (at: Date) =>
  at.toLocaleString('en-GB', { timeZone: ZONE, dateStyle: 'medium', timeStyle: 'short' }) +
  ' (UTC+7)';

// Renders the note with pdfkit's built-in Helvetica, so names are written as given; a name with
// Vietnamese diacritics needs an embedded font, which joins with the note's final layout.
export const renderHandoverNote = (input: HandoverNoteInput): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 56, info: { Title: input.contractCode } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.fontSize(18).text('TrekLink device handover note', { align: 'left' });
    doc
      .moveDown(0.3)
      .fontSize(10)
      .fillColor('#475569')
      .text(
        input.signaturePng ? `Signed ${stamp(input.at)}` : `Preview ${stamp(input.at)}, not signed`,
      );
    doc.fillColor('#000000').moveDown();

    doc.fontSize(12).text(`Contract: ${input.contractCode}`);
    doc.text(`Organization: ${input.organization.legalName} (${input.organization.code})`);
    doc.text(`Plan: ${input.planLabel}`);
    doc.text(`Requested start: ${input.requestedStartDate}`);
    doc.text(`First payment: ${input.firstPaymentConfirmed ? 'confirmed' : 'not confirmed'}`);
    doc.moveDown();

    doc.fontSize(12).text(`Devices (${input.devices.length} x ${input.variantCode})`);
    doc.moveDown(0.3).fontSize(10);
    input.devices.forEach((device, index) => {
      const battery =
        device.batteryPct === null ? 'battery not checked' : `battery ${device.batteryPct} %`;
      const gps =
        device.gpsFixOk === null
          ? 'GPS not checked'
          : device.gpsFixOk
            ? 'GPS fix ok'
            : 'no GPS fix';
      doc.text(`${index + 1}. ${device.assetTag}, ${battery}, ${gps}`);
    });
    doc.moveDown();

    doc
      .fontSize(10)
      .text(
        'The organization receives the devices above in working order and returns them at the counter ' +
          'when the contract ends. TrekLink is not a search-and-rescue provider.',
      );
    doc.moveDown();

    if (input.signer) {
      doc.fontSize(12).text(`Signed by: ${input.signer.fullName}, Org Manager`);
      doc.fontSize(10).text(`Identity seen at the counter: ${input.signer.identityChecked}`);
    }
    if (input.signaturePng) {
      doc.moveDown(0.5).image(input.signaturePng, { fit: [220, 90] });
    } else {
      doc.moveDown().fontSize(10).fillColor('#475569').text('Signature: ______________________');
    }
    doc.end();
  });
