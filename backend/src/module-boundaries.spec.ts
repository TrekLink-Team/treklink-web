import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectModuleFiles,
  findViolations,
  readOwnership,
} from '../scripts/check-module-boundaries';

const SCHEMA = `
// @module devices
model Device {
  id String @id
  @@map("devices")
}
model DeviceStatusHistory {
  id String @id
  @@map("device_status_history")
}

// @module rentals
model Booking {
  id String @id
  @@map("bookings")
}
`;

const ownership = readOwnership(SCHEMA);
const check = (module: string, text: string) =>
  findViolations([{ file: 'x.ts', module, text }], ownership).map((v) => [v.model, v.kind]);

describe('readOwnership', () => {
  it('assigns each model to the preceding @module marker with its mapped table', () => {
    expect([...ownership]).toEqual([
      ['Device', { module: 'devices', table: 'devices' }],
      ['DeviceStatusHistory', { module: 'devices', table: 'device_status_history' }],
      ['Booking', { module: 'rentals', table: 'bookings' }],
    ]);
  });

  it('refuses a model with no owner', () => {
    expect(() => readOwnership('model Orphan {\n  id String @id\n}')).toThrow(/Orphan/);
  });
});

describe('findViolations', () => {
  it('allows a module to use its own models', () => {
    expect(
      check(
        'devices',
        `await this.prisma.device.findMany();
         await tx.deviceStatusHistory.create({ data });
         const where: Prisma.DeviceWhereInput = {};
         import { Device } from '@prisma/client';
         await tx.$queryRaw\`SELECT * FROM "devices"\`;`,
      ),
    ).toEqual([]);
  });

  it('flags a Prisma accessor on another module model', () => {
    expect(check('rentals', 'await tx.device.update({ where, data });')).toEqual([
      ['Device', 'accessor'],
    ]);
  });

  it('distinguishes models that share a prefix', () => {
    expect(check('rentals', 'await this.prisma.deviceStatusHistory.count();')).toEqual([
      ['DeviceStatusHistory', 'accessor'],
    ]);
  });

  it('does not treat a property named like a model as an accessor', () => {
    expect(check('rentals', 'const id = allocation.device.id; this.device = device;')).toEqual([]);
  });

  it('flags Prisma namespace types and named imports of another module model', () => {
    expect(
      check(
        'incidents',
        `import { Booking, Prisma } from '@prisma/client';
         type Row = Prisma.BookingGetPayload<{ include: { trip: true } }>;`,
      ),
    ).toEqual([
      ['Booking', 'type'],
      ['Booking', 'import'],
    ]);
  });

  it('flags raw SQL against another module table', () => {
    expect(check('incidents', 'tx.$executeRaw`UPDATE devices SET status = ${s}`;')).toEqual([
      ['Device', 'sql'],
    ]);
    expect(check('incidents', 'SELECT 1 FROM "device_status_history" h')).toEqual([
      ['DeviceStatusHistory', 'sql'],
    ]);
  });

  it('reports the line of each violation', () => {
    const [violation] = findViolations(
      [{ file: 'a.ts', module: 'rentals', text: 'const a = 1;\n\nawait tx.device.findFirst();' }],
      ownership,
    );
    expect(violation).toMatchObject({ line: 3, module: 'rentals', owner: 'devices' });
  });
});

describe('the real schema and source tree', () => {
  const backend = join(__dirname, '..');
  const real = readOwnership(readFileSync(join(backend, 'prisma', 'schema.prisma'), 'utf8'));

  it('gives every model an owning module', () => {
    const modules = new Set([...real.values()].map((o) => o.module));
    expect(modules).toEqual(
      new Set([
        'platform',
        'auth',
        'devices',
        'trips',
        'rentals',
        'billing',
        'incidents',
        'gateway-sync',
      ]),
    );
  });

  it('has no boundary violation today', () => {
    expect(findViolations(collectModuleFiles(join(backend, 'src', 'modules')), real)).toEqual([]);
  });
});
