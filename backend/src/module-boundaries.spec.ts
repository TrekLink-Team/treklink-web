import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  collectModuleFiles,
  findCycle,
  findImportEdges,
  findUndeclaredEdges,
  findViolations,
  readDependencyGraph,
  readOwnership,
} from '../scripts/check-module-boundaries';

// The nine modules of D-033 (specs/platform design §2.1), and `demo`, the local demo control panel
// loaded only when DEMO_CONTROLS_ENABLED is true (D-088).
const MODULES = [
  'platform',
  'auth',
  'organizations',
  'devices',
  'rentals',
  'billing',
  'incidents',
  'gateway-sync',
  'monitoring',
  'demo',
];

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

const DESIGN = `
\`\`\`mermaid
flowchart TB
    PLT["platform"]
    ORG["organizations"]
    DEVS["devices"]
    RENT["rentals"]
    DEVS --> ORG
    RENT --> DEVS
    RENT -.->|"provides CUSTODY_RESOLVER"| DEVS
\`\`\`

***Figure 3***: Module dependencies.
`;

describe('readDependencyGraph', () => {
  const graph = readDependencyGraph(DESIGN);

  it('reads the solid edges, ignores ports and adds platform to every module', () => {
    expect(Object.fromEntries([...graph].map(([m, deps]) => [m, [...deps].sort()]))).toEqual({
      platform: [],
      organizations: ['platform'],
      devices: ['organizations', 'platform'],
      rentals: ['devices', 'platform'],
    });
  });

  it('refuses a design without the Figure 3 block', () => {
    expect(() => readDependencyGraph('no figure here')).toThrow(/Figure 3/);
  });

  it('refuses an edge to an undeclared node', () => {
    expect(() => readDependencyGraph(DESIGN.replace('RENT --> DEVS', 'RENT --> BILL'))).toThrow(
      /BILL/,
    );
  });
});

describe('findCycle', () => {
  const graphOf = (edges: Record<string, string[]>) =>
    new Map(Object.entries(edges).map(([m, deps]) => [m, new Set(deps)]));

  it('returns null for an acyclic graph', () => {
    expect(findCycle(readDependencyGraph(DESIGN))).toBeNull();
  });

  it('returns the modules of a cycle', () => {
    expect(findCycle(graphOf({ a: ['b'], b: ['c'], c: ['a'], platform: [] }))).toEqual([
      'a',
      'b',
      'c',
      'a',
    ]);
  });

  it('finds a self-import', () => {
    expect(findCycle(graphOf({ a: ['a'] }))).toEqual(['a', 'a']);
  });
});

describe('findImportEdges', () => {
  const modulesDir = '/b/src/modules';
  const edges = (module: string, file: string, text: string) =>
    findImportEdges([{ file: join(modulesDir, module, file), module, text }], modulesDir).map(
      (e) => [e.from, e.to, e.line],
    );

  it('reports imports into another module directory', () => {
    expect(
      edges(
        'rentals',
        'rentals.service.ts',
        `import { DevicesService } from '../devices/devices.service';
         export { CUSTODY_RESOLVER } from '../devices/ports';
         const m = await import('../billing/billing.module');
         import '../incidents/register';`,
      ),
    ).toEqual([
      ['rentals', 'devices', 1],
      ['rentals', 'devices', 2],
      ['rentals', 'billing', 3],
      ['rentals', 'incidents', 4],
    ]);
  });

  it('ignores imports inside the module and outside src/modules', () => {
    expect(
      edges(
        'rentals',
        'contracts/contract.service.ts',
        `import { Repo } from './contract.repository';
         import { RentalsModule } from '../rentals.module';
         import { PrismaService } from '../../../common/prisma/prisma.service';
         import { Injectable } from '@nestjs/common';`,
      ),
    ).toEqual([]);
  });

  it('flags only the edges the design does not declare', () => {
    const graph = readDependencyGraph(DESIGN);
    const found = findImportEdges(
      [
        {
          file: join(modulesDir, 'devices', 'x.ts'),
          module: 'devices',
          text: `import { A } from '../organizations/a';
                 import { B } from '../rentals/b';
                 import { C } from '../platform/c';`,
        },
      ],
      modulesDir,
    );
    expect(findUndeclaredEdges(found, graph).map((e) => [e.from, e.to])).toEqual([
      ['devices', 'rentals'],
    ]);
  });
});

describe('the real schema, design and source tree', () => {
  const backend = join(__dirname, '..');
  const modulesDir = join(backend, 'src', 'modules');
  const real = readOwnership(readFileSync(join(backend, 'prisma', 'schema.prisma'), 'utf8'));
  const graph = readDependencyGraph(
    readFileSync(join(backend, '..', 'specs', 'platform', 'design.md'), 'utf8'),
  );

  it('gives every model an owning module', () => {
    const modules = new Set([...real.values()].map((o) => o.module));
    // `demo` owns no model: it resets tables by name and seeds through the demo seed (D-088).
    expect(modules).toEqual(new Set(MODULES.filter((m) => m !== 'demo')));
  });

  it('draws the ten modules in Figure 3', () => {
    expect(new Set(graph.keys())).toEqual(new Set(MODULES));
  });

  it('keeps the Figure 3 dependency graph acyclic', () => {
    expect(findCycle(graph)).toBeNull();
  });

  it('has no source directory outside the module set', () => {
    const dirs = readdirSync(modulesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs.filter((d) => !MODULES.includes(d))).toEqual([]);
  });

  it('has no boundary violation today', () => {
    expect(findViolations(collectModuleFiles(modulesDir), real)).toEqual([]);
  });

  it('imports across modules only along Figure 3 edges', () => {
    const files = collectModuleFiles(modulesDir);
    expect(findUndeclaredEdges(findImportEdges(files, modulesDir), graph)).toEqual([]);
  });
});
