import { renderHandoverNote } from './handover-note.renderer';

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
});
