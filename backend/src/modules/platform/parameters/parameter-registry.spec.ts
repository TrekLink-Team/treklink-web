import { readFileSync } from 'fs';
import { join } from 'path';
import { isParameterKey, PARAMETER_TYPES } from './parameter-registry';

// The seeded rows of business_parameters: `('key', 'value'::jsonb, 'TYPE', ...`.
const SEED = join(__dirname, '../../../../prisma/migrations/20261004120100_seed/migration.sql');
const seededTypes = (): Record<string, string> => {
  const sql = readFileSync(SEED, 'utf8');
  const insert = sql.slice(sql.indexOf('INSERT INTO "business_parameters"'), sql.indexOf(';\n'));
  const rows = [...insert.matchAll(/^ {2}\('([^']+)', '(?:[^']|'')*'::jsonb, '([A-Z_]+)'/gm)];
  return Object.fromEntries(rows.map(([, key, type]) => [key, type]));
};

describe('parameter registry', () => {
  it('declares exactly the seeded keys, each with its seeded type', () => {
    const seeded = seededTypes();

    expect(Object.keys(seeded).length).toBeGreaterThan(0);
    expect(PARAMETER_TYPES).toEqual(seeded);
  });

  it('recognises a registry key and rejects any other string', () => {
    expect(isParameterKey('incidents.primaryAckTimeoutSeconds')).toBe(true);
    expect(isParameterKey('incidents.unknown')).toBe(false);
    expect(isParameterKey('toString')).toBe(false);
  });
});
