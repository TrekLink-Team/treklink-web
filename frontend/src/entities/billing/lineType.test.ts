import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INVOICE_LINE_TYPE_LABELS, lineTypeLabel } from './api';

// The values of the backend enum, read from the Prisma schema itself, so a value added there without a
// label here fails this test.
const schema = readFileSync(
  fileURLToPath(new URL('../../../../backend/prisma/schema.prisma', import.meta.url)),
  'utf8',
);
const enumValues = (name: string): string[] => {
  const body = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema)?.[1] ?? '';
  return body
    .split('\n')
    .map((row) => row.replace(/\/\/.*$/, '').trim())
    .filter(Boolean);
};

describe('lineTypeLabel (screen 6.1)', () => {
  it('has an English label for every InvoiceLineType of the backend schema', () => {
    const values = enumValues('InvoiceLineType');
    expect(values).toContain('HOLDING_FEE');
    for (const value of values) {
      expect(Object.hasOwn(INVOICE_LINE_TYPE_LABELS, value), `label for ${value}`).toBe(true);
      expect(lineTypeLabel(value)).not.toBe(value);
    }
    // No label for a value the backend no longer has.
    expect(Object.keys(INVOICE_LINE_TYPE_LABELS).sort()).toEqual([...values].sort());
  });

  it('reads HOLDING_FEE as "Holding fee" and keeps an unknown code readable', () => {
    expect(lineTypeLabel('HOLDING_FEE')).toBe('Holding fee');
    expect(lineTypeLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
