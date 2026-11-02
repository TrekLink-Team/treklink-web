import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MemberRole, OrganizationStatus } from '@prisma/client';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AccountsService } from '../src/modules/auth';
import { AccountsRepository } from '../src/modules/auth/accounts.repository';
import { OneTimeCodeService } from '../src/modules/auth/one-time-code.service';
import { PasswordFlowsService } from '../src/modules/auth/password-flows.service';
import { MembersRepository } from '../src/modules/organizations/members.repository';
import { OrganizationLifecycle } from '../src/modules/organizations/organization-lifecycle';
import {
  OrganizationOnboardingService,
  Registration,
} from '../src/modules/organizations/organization-onboarding.service';
import { OrganizationsRepository } from '../src/modules/organizations/organizations.repository';
import { ValidatedEnvironment } from '../src/modules/platform/config/environment-variables';
import { TransactionalEvents } from '../src/modules/platform/events/emit-after-commit';
import { ParameterService } from '../src/modules/platform/parameters/parameter.service';

// Capture explicit connection settings before Prisma can load a local .env at construction.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !process.env.DATABASE_DIRECT_URL) {
  throw new Error('test:db requires explicit DATABASE_URL and DATABASE_DIRECT_URL.');
}

// Organizations task 2.1 against Postgres (api-design 01, FR-ORG-01): registration writes the
// organization, the Manager account, the membership and the first transition in one transaction, so a
// failure after the account insert leaves none of them behind. Run only through test:db against a
// migrated disposable database. Fixtures carry a fresh run ID and are never deleted.
describe('Organization registration against Postgres (organizations 2.1)', () => {
  const prisma = new PrismaService({ datasourceUrl: databaseUrl });
  const events = new TransactionalEvents(prisma, new EventEmitter2());
  const accountsRepository = new AccountsRepository(prisma);
  const parameters = { get: () => Promise.resolve(72) } as unknown as ParameterService;
  const mail = { sendCode: () => Promise.resolve() } as unknown as PasswordFlowsService;
  const config = {
    get: (key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100),
  } as unknown as ConfigService<ValidatedEnvironment, true>;
  const accounts = new AccountsService(
    accountsRepository,
    new OneTimeCodeService(accountsRepository, parameters),
    mail,
    events,
    config,
  );
  const organizations = new OrganizationsRepository(prisma);
  const members = new MembersRepository(prisma);
  // The membership insert is the step after the account insert; this fails it.
  const failingMembers = {
    addMember: () => Promise.reject(new Error('membership insert failed')),
  } as unknown as MembersRepository;
  const lifecycle = {} as unknown as OrganizationLifecycle;
  const run = randomUUID().slice(0, 8);
  let serial = 0;

  const registration = (): Registration => {
    serial += 1;
    return {
      legalName: `Registration test ${run}-${serial}`,
      taxCode: `RG${run}${serial}`,
      address: '1 Test Street',
      contactPhone: '0900000000',
      managerFullName: 'Test Manager',
      managerEmail: `registration-${run}-${serial}@example.invalid`,
      managerPhone: '0900000001',
    };
  };

  const serviceWith = (membersRepository: MembersRepository) =>
    new OrganizationOnboardingService(
      organizations,
      membersRepository,
      accounts,
      events,
      config,
      parameters,
      lifecycle,
    );

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('writes the organization, the Manager account, the membership and the first transition together', async () => {
    const input = registration();

    const created = await serviceWith(members).register(input);

    const organization = await prisma.organization.findUniqueOrThrow({
      where: { id: created.id },
      include: { members: { include: { user: true } }, transitions: true },
    });
    expect(organization.status).toBe(OrganizationStatus.PENDING);
    expect(organization.members).toHaveLength(1);
    expect(organization.members[0]).toMatchObject({ role: MemberRole.MANAGER });
    expect(organization.members[0].user.email).toBe(input.managerEmail.toLowerCase());
    expect(organization.transitions).toHaveLength(1);
    expect(organization.transitions[0]).toMatchObject({
      fromStatus: null,
      toStatus: OrganizationStatus.PENDING,
    });
  });

  it('rolls back the organization and the Manager account when the membership insert fails', async () => {
    const input = registration();

    await expect(serviceWith(failingMembers).register(input)).rejects.toThrow(
      'membership insert failed',
    );

    expect(await prisma.organization.count({ where: { taxCode: input.taxCode } })).toBe(0);
    expect(await prisma.user.count({ where: { email: input.managerEmail.toLowerCase() } })).toBe(0);
    // Nothing was committed, so the same registration passes once the fault is gone.
    await expect(serviceWith(members).register(input)).resolves.toMatchObject({
      taxCode: input.taxCode,
    });
  });
});
