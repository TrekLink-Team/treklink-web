import { randomUUID } from 'node:crypto';
import { HttpStatus, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AccountType, OrganizationStatus } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../src/common/errors';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { BrokerAuthService } from '../src/modules/gateway-sync/broker-hooks.service';
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

// organizations AC-06 through the broker's user check (gateway-sync task 3.1, api-design 01): a Field
// Station credential created by its Manager connects with its secret; once revoked, its next
// connection is refused with 403 CREDENTIAL_REJECTED; a station of a CLOSED organization is refused
// too. The real FieldStationsService and repository read Postgres; go-auth's cache in front of the
// hook is the broker's concern and not exercised here. Run only through test:db against a migrated
// disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('Broker user check against Postgres (organizations AC-06)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const accountsRepository = new AccountsRepository(prisma);
  const parameters = {
    get: () => Promise.resolve(10),
  } as unknown as ParameterService;
  const env: Record<string, unknown> = {
    BCRYPT_COST: 4,
    MQTT_BROKER_URL: 'mqtt://localhost:1883',
    MQTT_ROOT: 'treklink',
    MQTT_AUTH_HOOK_SECRET: 'db-broker-hook-secret-0123',
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService<
    ValidatedEnvironment,
    true
  >;
  const stations = new FieldStationsService(
    new FieldStationsRepository(prisma),
    new OrganizationsRepository(prisma),
    new FieldStationReleaseService(config),
    parameters,
    events,
    config,
  );
  const brokerAuth = new BrokerAuthService(stations, config);
  const runId = randomUUID();
  let serial = 0;

  const organization = async () => {
    serial += 1;
    const org = await prisma.organization.create({
      data: {
        code: `B-${runId.slice(0, 8)}-${serial}`,
        legalName: `Broker test ${serial}`,
        taxCode: `B${runId}-${serial}`,
        address: '1 Test Street',
        contactEmail: `broker-test-${runId}-${serial}@example.invalid`,
        contactPhone: '0900000000',
        status: OrganizationStatus.ACTIVE,
      },
    });
    const user = await accountsRepository.create({
      email: `broker-test-${runId}-${serial}@example.invalid`,
      fullName: `Broker test ${serial}`,
      accountType: AccountType.ORGANIZATION,
      roleKeys: ['ORG_MANAGER'],
    });
    const caller: Caller = { id: user.id, roles: ['ORG_MANAGER'], organizationId: org.id };
    return { org, caller };
  };

  const refused = async (promise: Promise<unknown>) => {
    const error = await promise.then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DomainException);
    expect((error as DomainException).getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect((error as DomainException).getResponse()).toMatchObject({
      errorCode: ErrorCode.CREDENTIAL_REJECTED,
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  it('accepts a new station with its secret and refuses it at its next connection once revoked', async () => {
    const { org, caller } = await organization();
    const created = await stations.create(org.id, 'Ta Nang laptop', caller);
    const connect = (password: string) =>
      brokerAuth.checkUser({ username: created.mqttUsername, password, clientid: 'fs-db' });

    await expect(connect(created.mqttSecret)).resolves.toEqual({
      allowed: true,
      kind: 'FIELD_STATION',
    });
    await refused(connect('not-the-secret'));

    await stations.revoke(org.id, created.id, 'laptop lost', caller);

    await refused(connect(created.mqttSecret));
  });

  it('refuses a station of a CLOSED organization and still admits one of a SUSPENDED organization', async () => {
    const { org, caller } = await organization();
    const created = await stations.create(org.id, 'Bidoup laptop', caller);
    const connect = () =>
      brokerAuth.checkUser({
        username: created.mqttUsername,
        password: created.mqttSecret,
        clientid: 'fs-db',
      });

    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrganizationStatus.SUSPENDED },
    });
    await expect(connect()).resolves.toMatchObject({ allowed: true });

    await prisma.organization.update({
      where: { id: org.id },
      data: { status: OrganizationStatus.CLOSED },
    });
    await refused(connect());
  });

  it('refuses a username no station holds', async () => {
    await refused(
      brokerAuth.checkUser({ username: `fs-nobody-${serial}9`, password: 'x', clientid: 'fs-db' }),
    );
  });
});
