import * as fs from 'node:fs';
import { renderHandoverNote, type HandoverNoteInput } from './handover-note.renderer';

describe('handover note Unicode font (rentals task 2.4)', () => {
  it('embeds a font and Unicode mapping for Vietnamese organization and signer names', async () => {
    const pdf = await renderHandoverNote({
      contractCode: 'RC-2026-0001',
      organization: { code: 'ORG-0001', legalName: 'Nguyễn Đặng Trekking' },
      planLabel: 'Monthly',
      variantCode: 'treklink-v3',
      requestedStartDate: '2026-10-30',
      devices: [{ assetTag: 'TL-0001', batteryPct: 85, gpsFixOk: true }],
      firstPaymentConfirmed: true,
      signer: { fullName: 'Lâm Phi Long', identityChecked: 'ID ending 1234' },
      at: new Date('2026-10-30T07:00:00Z'),
    });
    const contents = pdf.toString('latin1');
    expect(contents.startsWith('%PDF-')).toBe(true);
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
    const input: HandoverNoteInput = {
      contractCode: 'RC-2026-0002',
      organization: { code: 'ORG-0001', legalName: 'Demo Trekking' },
      planLabel: 'Monthly',
      variantCode: 'treklink-v3',
      requestedStartDate: '2026-10-30',
      devices: [],
      firstPaymentConfirmed: false,
      at: new Date('2026-10-30T07:00:00Z'),
    };
    await render(input);
    await render(input);
    const fontReads = read.mock.calls.filter(([path]) => String(path).endsWith('DejaVuSans.ttf'));
    expect(fontReads).toHaveLength(1);
    read.mockRestore();
  });
});
