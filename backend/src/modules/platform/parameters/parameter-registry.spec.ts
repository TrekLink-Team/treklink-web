import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { isParameterKey, PARAMETER_TYPES } from './parameter-registry';

// The rows of business_parameters after every migration, in order: each
// `INSERT INTO "business_parameters"` adds `('key', 'value'::jsonb, 'TYPE', ...` rows, and a
// `DELETE FROM "business_parameters" WHERE "key" IN (...)` retires keys (D-072 retired two).
const MIGRATIONS = join(__dirname, '../../../../prisma/migrations');
const seededTypes = (): Record<string, string> => {
  const types: Record<string, string> = {};
  const dirs = readdirSync(MIGRATIONS, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const dir of dirs.map((d) => d.name).sort()) {
    const sql = readFileSync(join(MIGRATIONS, dir, 'migration.sql'), 'utf8');
    for (const insert of sql.matchAll(/INSERT INTO "business_parameters"[\s\S]*?;\n/g)) {
      for (const [, key, type] of insert[0].matchAll(
        /^ {2}\('([^']+)', '(?:[^']|'')*'::jsonb, '([A-Z_]+)'/gm,
      )) {
        types[key] = type;
      }
    }
    for (const del of sql.matchAll(
      /DELETE FROM "business_parameters" WHERE "key" IN \(([^)]*)\)/g,
    )) {
      for (const [, key] of del[1].matchAll(/'([^']+)'/g)) delete types[key];
    }
  }
  return types;
};

describe('parameter registry', () => {
  it('declares exactly the keys the migrations leave, each with its seeded type', () => {
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
