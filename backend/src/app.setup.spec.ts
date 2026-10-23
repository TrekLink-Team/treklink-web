import { parseCorsOrigins } from './app.setup';

describe('parseCorsOrigins', () => {
  it('splits a comma-separated list and trims each origin', () => {
    expect(parseCorsOrigins('http://localhost:5173, https://app.treklink.vn')).toEqual([
      'http://localhost:5173',
      'https://app.treklink.vn',
    ]);
  });

  it('drops empty entries', () => {
    expect(parseCorsOrigins('http://localhost:5173,, ')).toEqual(['http://localhost:5173']);
  });
});
