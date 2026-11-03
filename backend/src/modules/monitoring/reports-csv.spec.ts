import { toCsv } from './reports-csv';

describe('toCsv (monitoring api-design 08, format=csv)', () => {
  it('writes the header row and one row per record, LF separated, with no trailing line end', () => {
    const csv = toCsv(
      ['variant', 'invoicedVnd'],
      [
        { variant: 'treklink-v3', invoicedVnd: 18_000_000 },
        { variant: 'treklink-v2', invoicedVnd: 0 },
      ],
    );
    expect(csv).toBe('variant,invoicedVnd\ntreklink-v3,18000000\ntreklink-v2,0');
  });

  it('writes only the header for no rows', () => {
    expect(toCsv(['a', 'b'], [])).toBe('a,b');
  });

  it('quotes a value with a comma, a quote or a line break and doubles its quotes', () => {
    const csv = toCsv(
      ['organization'],
      [
        { organization: 'ACME, Trek Co.' },
        { organization: 'The "Big" One' },
        { organization: 'Line\nbreak' },
        { organization: 'Plain' },
      ],
    );
    expect(csv).toBe('organization\n"ACME, Trek Co."\n"The ""Big"" One"\n"Line\nbreak"\nPlain');
  });

  it('writes a missing value as an empty cell and keeps zero', () => {
    const csv = toCsv(['a', 'b', 'c'], [{ a: null, b: 0, c: undefined }]);
    expect(csv).toBe('a,b,c\n,0,');
  });

  it('follows the column list, whatever order the row keys are in, and ignores extra keys', () => {
    expect(toCsv(['b', 'a'], [{ a: 1, b: 2, c: 3 }])).toBe('b,a\n2,1');
  });
});
