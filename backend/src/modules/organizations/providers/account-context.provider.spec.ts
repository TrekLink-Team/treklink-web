import { Inject, Injectable, Module, Optional } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACCOUNT_CONTEXT_PROVIDER, AccountContextProvider } from '../../auth';
import { MembersRepository } from '../members.repository';
import { OrganizationsPortsModule } from '../organizations-ports.module';
import { OrganizationAccountContextProvider } from './account-context.provider';

const memberRow = {
  role: 'MANAGER',
  organization: { id: 'org-1', code: 'ORG-0001', legalName: 'Demo Tours', status: 'ACTIVE' },
};

describe('OrganizationAccountContextProvider', () => {
  let findFirst: jest.Mock;
  let findMany: jest.Mock;
  let provider: OrganizationAccountContextProvider;

  beforeEach(() => {
    findFirst = jest.fn();
    findMany = jest.fn();
    const prisma = { organizationMember: { findFirst, findMany } } as unknown as PrismaService;
    provider = new OrganizationAccountContextProvider(new MembersRepository(prisma));
  });

  it('returns the organization, its code and name, the member role and the status', async () => {
    findFirst.mockResolvedValue(memberRow);

    await expect(provider.forUser('user-1')).resolves.toEqual({
      organizationId: 'org-1',
      organizationCode: 'ORG-0001',
      legalName: 'Demo Tours',
      memberRole: 'MANAGER',
      organizationStatus: 'ACTIVE',
    });
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1', deactivatedAt: null } }),
    );
  });

  it('returns null for an account with no live member row (TrekLink, or deactivated)', async () => {
    findFirst.mockResolvedValue(null);

    await expect(provider.forUser('staff-1')).resolves.toBeNull();
  });

  it('names the organization of each member for the authentication log, deactivated or not', async () => {
    findMany.mockResolvedValue([
      { userId: 'user-1', organization: { id: 'org-1', legalName: 'Demo Tours' } },
    ]);

    await expect(provider.organizationsOf(['user-1', 'staff-1'])).resolves.toEqual(
      new Map([['user-1', { id: 'org-1', name: 'Demo Tours' }]]),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: { in: ['user-1', 'staff-1'] } } }),
    );
    await expect(provider.organizationsOf([])).resolves.toEqual(new Map());
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('lists every account that is or was a member of the organization', async () => {
    findMany.mockResolvedValue([{ userId: 'user-1' }, { userId: 'user-2' }]);

    await expect(provider.memberUserIds('org-1')).resolves.toEqual(['user-1', 'user-2']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { organizationId: 'org-1' } }),
    );
  });
});

// A lower module receives the port without importing `organizations` (platform design §2.1).
@Injectable()
class LowerModuleConsumer {
  constructor(
    @Optional() @Inject(ACCOUNT_CONTEXT_PROVIDER) readonly port?: AccountContextProvider,
  ) {}
}

@Module({ providers: [LowerModuleConsumer] })
class LowerModule {}

describe('OrganizationsPortsModule', () => {
  it('makes ACCOUNT_CONTEXT_PROVIDER injectable in a module that does not import it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LowerModule, OrganizationsPortsModule],
    })
      .useMocker((token) => (token === PrismaService ? {} : undefined))
      .compile();

    expect(moduleRef.get(LowerModuleConsumer).port).toBeInstanceOf(
      OrganizationAccountContextProvider,
    );
  });
});
