import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { Caller } from '../src/common/decorators/access.decorator';
import { ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { FIELD_STATION_REVOKED } from '../src/modules/organizations/field-station-events';
import { FieldStationReleaseService } from '../src/modules/organizations/field-station-release.service';
import { FieldStationsRepository } from '../src/modules/organizations/field-stations.repository';
import { FieldStationsService } from '../src/modules/organizations/field-stations.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

const LIMIT = 2;

// Field Station credentials against Postgres (organizations task 2.8, REQ-ERR-06, REQ-UBI-03): the
// limit under concurrent creates, the numbering of usernames, the hash behind a username, a revoke that
// tells `gateway-sync` once, and the health a station reports. Run only through test:db against a
// migrated disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('Field Station credentials against Postgres (REQ-UBI-03, REQ-EVT-09, REQ-ERR-06)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const emitter = new EventEmitter2();
  const events = new TransactionalEvents(prisma, emitter);
  const accountsRepository = new AccountsRepository(prisma);
  const parameters = {
    get: (key: string) => Promise.resolve(key === 'organizations.maxFieldStations' ? LIMIT : 10),
  } as unknown as ParameterService;
  const env: Record<string, unknown> = { BCRYPT_COST: 4, MQTT_BROKER_URL: 'mqtt://localhost:1883' };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService<
    ValidatedEnvironment,
    true
  >;
  const service = new FieldStationsService(
    new FieldStationsRepository(prisma),
    new OrganizationsRepository(prisma),
    new FieldStationReleaseService(config),
    parameters,
    events,
    config,
  );
  const runId = randomUUID();
  let serial = 0;

  const organization = async () => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `F-${runId.slice(0, 8)}-${serial}`,
        legalName: `Stations test ${serial}`,
        taxCode: `F${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `stations-test-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const user = await accountsRepository.create({
      email: `stations-test-${runId}-${serial}@example.invalid`,
      fullName: `Stations test ${serial}`,
      accountType: AccountType.ORGANIZATION,
      roleKeys: ['ORG_MANAGER'],
    });
    const caller: Caller = { id: user.id, roles: ['ORG_MANAGER'], organizationId: org.id };
    return { org, caller };
  };

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lets only two of three concurrent creates pass at a limit of two, with different usernames', async () => {
    const { org, caller } = await organization();

    const results = await Promise.allSettled(
      ['A', 'B', 'C'].map((name) => service.create(org.id, `Laptop ${name}`, caller)),
    );

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(LIMIT);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { errorCode: ErrorCode.STATION_LIMIT },
    });
    const rows = await prisma.fieldStation.findMany({
      where: { organizationId: org.id },
      select: { mqttUsername: true },
    });
    const prefix = `fs-${org.code.toLowerCase()}-`;
    expect(rows.map((row) => row.mqttUsername).sort()).toEqual([`${prefix}1`, `${prefix}2`]);
  });

  it('stores only the hash of the secret, which the username leads to, and never lists it', async () => {
    const { org, caller } = await organization();

    const created = await service.create(org.id, 'Ta Nang laptop', caller);

    const credential = await service.byUsername(created.mqttUsername);
    expect(credential).toMatchObject({ id: created.id, organizationId: org.id, revokedAt: null });
    expect(await bcrypt.compare(created.mqttSecret, credential?.secretHash ?? '')).toBe(true);
    expect(credential?.secretHash).not.toContain(created.mqttSecret);
    expect(await service.byUsername('fs-nobody-0')).toBeNull();
    const listed = JSON.stringify(await service.list(org.id, caller));
    expect(listed).not.toContain(created.mqttSecret);
    expect(listed).not.toContain('secretHash');
  });

  it('does not number a username twice after a revoke, and tells gateway-sync of a revoke once', async () => {
    const { org, caller } = await organization();
    const seen: unknown[] = [];
    const listener = (payload: unknown) => seen.push(payload);
    emitter.on(FIELD_STATION_REVOKED, listener);

    const first = await service.create(org.id, 'First', caller);
    await service.revoke(org.id, first.id, undefined, caller);
    const again = await service.revoke(org.id, first.id, undefined, caller);
    emitter.off(FIELD_STATION_REVOKED, listener);
    const second = await service.create(org.id, 'Second', caller);

    expect(again.revokedAt).toBeInstanceOf(Date);
    expect(seen).toEqual([
      { organizationId: org.id, fieldStationId: first.id, mqttUsername: first.mqttUsername },
    ]);
    expect(second.mqttUsername).toBe(`fs-${org.code.toLowerCase()}-2`);
    expect((await service.list(org.id, caller)).items).toHaveLength(2);
  });

  it('frees the limit when a station is revoked', async () => {
    const { org, caller } = await organization();
    const a = await service.create(org.id, 'A', caller);
    await service.create(org.id, 'B', caller);
    await expect(service.create(org.id, 'C', caller)).rejects.toMatchObject({
      errorCode: ErrorCode.STATION_LIMIT,
    });

    await service.revoke(org.id, a.id, undefined, caller);

    await expect(service.create(org.id, 'C', caller)).resolves.toMatchObject({ name: 'C' });
  });

  it('records the health a station reports and shows it as an object, null before the first report', async () => {
    const { org, caller } = await organization();
    const created = await service.create(org.id, 'Ta Nang laptop', caller);
    expect((await service.list(org.id, caller)).items[0]).toMatchObject({
      queueDepth: null,
      lastSyncAt: null,
      version: null,
      outdated: false,
    });

    const at = new Date();
    await service.recordStationHealth(created.id, {
      queueDepth: [0, 0, 3, 12],
      oldestRetryCount: 2,
      version: '1.1.0',
      at,
    });

    expect((await service.list(org.id, caller)).items[0]).toMatchObject({
      queueDepth: { p0: 0, p1: 0, p2: 3, p3: 12 },
      oldestRetryCount: 2,
      version: '1.1.0',
      lastSyncAt: at,
      outdated: false,
    });
  });

  it('refuses a create for an organization that is not ACTIVE, and keeps another organization out of reach', async () => {
    const { org, caller } = await organization();
    const other = await organization();
    const created = await service.create(org.id, 'Ta Nang laptop', caller);

    await expect(
      service.revoke(other.org.id, created.id, undefined, other.caller),
    ).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service.list(org.id, other.caller)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });

    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    await expect(service.create(org.id, 'Another', caller)).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
    });
    await expect(
      service.revoke(org.id, created.id, 'Suspended for default', {
        id: caller.id,
        roles: ['STAFF'],
        organizationId: null,
      }),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) as unknown });
  });
});
