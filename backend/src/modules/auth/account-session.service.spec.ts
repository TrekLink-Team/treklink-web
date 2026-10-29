import { AccountType } from '@prisma/client';
import { AccountSessionService } from './account-session.service';
import { AccountContextProvider } from './ports/account-context.port';
import { AccountsRepository } from './accounts.repository';
import { anAccount } from './testing/auth-fixtures';

describe('AccountSessionService', () => {
  const member = anAccount({
    id: 'member-1',
    email: 'manager@acme-trek.vn',
    accountType: AccountType.ORGANIZATION,
    roles: ['ORG_MANAGER'],
  });
  let repository: { findById: jest.Mock };
  let provider: { forUser: jest.Mock };
  let service: AccountSessionService;

  beforeEach(() => {
    repository = { findById: jest.fn() };
    provider = {
      forUser: jest.fn().mockResolvedValue({
        organizationId: 'org-1',
        organizationCode: 'ORG-0001',
        legalName: 'ACME Trek Co., Ltd.',
        memberRole: 'MANAGER',
        organizationStatus: 'ACTIVE',
      }),
    };
    service = new AccountSessionService(
      repository as unknown as AccountsRepository,
      provider as unknown as AccountContextProvider,
    );
  });

  it('builds the session of an active TrekLink account without a membership lookup', async () => {
    await expect(service.eligible(anAccount())).resolves.toEqual({
      id: 'user-1',
      email: 'staff@treklink.vn',
      fullName: 'Tran Thi B',
      accountType: AccountType.TREKLINK,
      roles: ['STAFF'],
      organization: null,
    });
    expect(provider.forUser).not.toHaveBeenCalled();
  });

  it.each([
    ['inactive', { isActive: false }],
    ['soft-deleted', { deletedAt: new Date() }],
    ['without a password yet', { passwordHash: null }],
  ])('refuses an account that is %s (REQ-STA-02)', async (_label, overrides) => {
    await expect(service.eligible(anAccount(overrides))).resolves.toBeNull();
  });

  it('attaches the membership of an organization account with its code and legal name', async () => {
    await expect(service.eligible(member)).resolves.toMatchObject({
      organization: {
        id: 'org-1',
        code: 'ORG-0001',
        legalName: 'ACME Trek Co., Ltd.',
        status: 'ACTIVE',
        memberRole: 'MANAGER',
      },
    });
  });

  it.each(['CLOSED', 'REJECTED'])('refuses a member of a %s organization', async (status) => {
    provider.forUser.mockResolvedValue({
      organizationId: 'org-1',
      organizationCode: 'ORG-0001',
      legalName: 'ACME Trek Co., Ltd.',
      memberRole: 'OPERATOR',
      organizationStatus: status,
    });
    await expect(service.eligible(member)).resolves.toBeNull();
  });

  it.each(['PENDING', 'SUSPENDED'])('lets a member of a %s organization in', async (status) => {
    provider.forUser.mockResolvedValue({
      organizationId: 'org-1',
      organizationCode: 'ORG-0001',
      legalName: 'ACME Trek Co., Ltd.',
      memberRole: 'OPERATOR',
      organizationStatus: status,
    });
    await expect(service.eligible(member)).resolves.toMatchObject({
      organization: { status },
    });
  });

  it('refuses a deactivated member (null membership)', async () => {
    provider.forUser.mockResolvedValue(null);
    await expect(service.eligible(member)).resolves.toBeNull();
  });

  it('refuses every organization account while no provider is registered', async () => {
    const withoutProvider = new AccountSessionService(repository as unknown as AccountsRepository);
    await expect(withoutProvider.eligible(member)).resolves.toBeNull();
  });

  it('caches the membership for 30 s and forgets it on member.deactivated', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);

    await service.eligible(member);
    await service.eligible(member);
    expect(provider.forUser).toHaveBeenCalledTimes(1);

    now.mockReturnValue(1_000_000 + 30_001);
    await service.eligible(member);
    expect(provider.forUser).toHaveBeenCalledTimes(2);

    service.forgetMembership({ userId: 'member-1' });
    await service.eligible(member);
    expect(provider.forUser).toHaveBeenCalledTimes(3);
    now.mockRestore();
  });

  it('loads by id, and returns null for an unknown id', async () => {
    repository.findById.mockResolvedValueOnce(anAccount()).mockResolvedValueOnce(null);

    await expect(service.load('user-1')).resolves.toMatchObject({ id: 'user-1' });
    await expect(service.load('missing')).resolves.toBeNull();
  });
});
