import { AccountType, AuthEventType } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ACCOUNT_SELECT, AccountsRepository, normalizeEmail } from './accounts.repository';

const NOW = new Date('2026-10-23T03:00:00.000Z');

const userRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'user-1',
  email: 'staff@treklink.vn',
  fullName: 'Tran Thi B',
  accountType: AccountType.TREKLINK,
  isActive: true,
  deletedAt: null,
  passwordHash: 'hash',
  lockedUntil: null,
  lastLoginAt: null,
  roles: [{ role: { key: 'STAFF' } }],
  ...overrides,
});

describe('normalizeEmail', () => {
  it('trims and lower-cases (REQ-UBI-01)', () => {
    expect(normalizeEmail('  Manager@ACME-Trek.VN ')).toBe('manager@acme-trek.vn');
  });
});

describe('AccountsRepository', () => {
  let prisma: {
    user: Record<string, jest.Mock>;
    role: { findMany: jest.Mock };
    authEvent: { count: jest.Mock; create: jest.Mock };
    refreshToken: Record<string, jest.Mock>;
  };
  let repository: AccountsRepository;

  beforeEach(() => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(userRow()),
        update: jest.fn().mockResolvedValue(undefined),
      },
      role: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'role-staff', key: 'STAFF', accountType: AccountType.TREKLINK },
          { id: 'role-manager', key: 'ORG_MANAGER', accountType: AccountType.ORGANIZATION },
        ]),
      },
      authEvent: { count: jest.fn().mockResolvedValue(3), create: jest.fn() },
      refreshToken: {
        create: jest.fn().mockResolvedValue({ id: 'rt-1' }),
        findUnique: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    repository = new AccountsRepository(prisma as unknown as PrismaService);
  });

  it('finds by lower-cased email and flattens the role keys', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow());

    await expect(repository.findByEmail('Staff@TrekLink.vn')).resolves.toMatchObject({
      id: 'user-1',
      roles: ['STAFF'],
    });
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: 'staff@treklink.vn' },
      select: ACCOUNT_SELECT,
    });
  });

  it('returns null for an unknown email or id', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(repository.findByEmail('who@nowhere.vn')).resolves.toBeNull();
    await expect(repository.findById('missing')).resolves.toBeNull();
  });

  it('finds by id', async () => {
    prisma.user.findUnique.mockResolvedValue(userRow());
    await expect(repository.findById('user-1')).resolves.toMatchObject({ roles: ['STAFF'] });
  });

  describe('create', () => {
    it('stores the email lower-case and grants the roles', async () => {
      await repository.create({
        email: 'New.Staff@TrekLink.vn',
        fullName: 'Nguyen Van D',
        accountType: AccountType.TREKLINK,
        roleKeys: ['STAFF'],
        createdById: 'admin-1',
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: 'new.staff@treklink.vn',
          fullName: 'Nguyen Van D',
          phoneNumber: null,
          accountType: AccountType.TREKLINK,
          createdById: 'admin-1',
          roles: { create: [{ roleId: 'role-staff', grantedById: 'admin-1' }] },
        },
        select: ACCOUNT_SELECT,
      });
    });

    it('records a self-registered account with no creator and its phone number', async () => {
      await repository.create({
        email: 'manager@acme-trek.vn',
        fullName: 'Nguyen Van A',
        phoneNumber: '0900000000',
        accountType: AccountType.ORGANIZATION,
        roleKeys: ['ORG_MANAGER'],
      });

      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            phoneNumber: '0900000000',
            createdById: null,
            roles: { create: [{ roleId: 'role-manager', grantedById: null }] },
          }) as unknown,
        }),
      );
    });

    it('rejects a mixed-case duplicate email, including soft-deleted accounts (REQ-ERR-05)', async () => {
      prisma.user.findFirst.mockResolvedValue({ id: 'user-old' });

      await expect(
        repository.create({
          email: 'STAFF@treklink.vn',
          fullName: 'Again',
          phoneNumber: '0900000000',
          accountType: AccountType.TREKLINK,
          roleKeys: ['STAFF'],
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.CONFLICT_UNIQUE,
        message: 'staff@treklink.vn is already registered.',
      });
      expect(prisma.user.findFirst).toHaveBeenCalledWith({
        where: { email: { equals: 'staff@treklink.vn', mode: 'insensitive' } },
        select: { id: true },
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it.each([
      ['a role of the other account type', 'ORG_MANAGER'],
      ['an unknown role', 'OWNER'],
    ])('rejects %s (REQ-UBI-03)', async (_label, roleKey) => {
      await expect(
        repository.create({
          email: 'x@treklink.vn',
          fullName: 'X',
          accountType: AccountType.TREKLINK,
          roleKeys: [roleKey],
        }),
      ).rejects.toMatchObject({
        errorCode: ErrorCode.VALIDATION_FAILED,
        message: `Role ${roleKey} cannot be held by a TREKLINK account.`,
      });
      expect(prisma.user.create).not.toHaveBeenCalled();
    });
  });

  it('counts sign-in failures after a time', async () => {
    await expect(repository.countLoginFailuresSince('user-1', NOW)).resolves.toBe(3);
    expect(prisma.authEvent.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', type: AuthEventType.LOGIN_FAILED, createdAt: { gt: NOW } },
    });
  });

  it('records a failure, with the lock only when one is given', async () => {
    await repository.recordLoginFailure('user-1', 2, null);
    await repository.recordLoginFailure('user-1', 5, NOW);

    expect(prisma.user.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'user-1' },
      data: { failedLoginCount: 2 },
    });
    expect(prisma.user.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'user-1' },
      data: { failedLoginCount: 5, lockedUntil: NOW },
    });
  });

  it('records a success: counter and lock cleared, last sign-in set', async () => {
    await repository.recordLoginSuccess('user-1', NOW);
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: NOW },
    });
  });

  it('appends an auth event', async () => {
    const event = {
      userId: null,
      email: 'who@nowhere.vn',
      type: AuthEventType.LOGIN_FAILED,
      ip: null,
      userAgent: null,
    };
    await repository.insertAuthEvent(event);
    expect(prisma.authEvent.create).toHaveBeenCalledWith({ data: event });
  });

  it('creates and finds refresh tokens by hash', async () => {
    const token = {
      userId: 'user-1',
      familyId: 'family-1',
      tokenHash: 'abc',
      expiresAt: NOW,
      ip: null,
      userAgent: null,
    };
    await expect(repository.createRefreshToken(token)).resolves.toEqual({ id: 'rt-1' });
    await expect(repository.findRefreshTokenByHash('abc')).resolves.toBeNull();
    expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: 'abc' } }),
    );
  });

  it('revokes a live token by compare-and-set and reports whether it did', async () => {
    await expect(repository.revokeIfLive('rt-1', NOW, 'rt-2')).resolves.toBe(true);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { id: 'rt-1', revokedAt: null },
      data: { revokedAt: NOW, replacedById: 'rt-2' },
    });

    prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.revokeIfLive('rt-1', NOW, null)).resolves.toBe(false);
  });

  it('revokes a family and a user token', async () => {
    await repository.revokeFamily('user-1', 'family-1', NOW);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', familyId: 'family-1', revokedAt: null },
      data: { revokedAt: NOW },
    });

    await expect(repository.revokeUserToken('user-1', 'abc', NOW)).resolves.toBe(true);
    expect(prisma.refreshToken.updateMany).toHaveBeenLastCalledWith({
      where: { userId: 'user-1', tokenHash: 'abc', revokedAt: null },
      data: { revokedAt: NOW },
    });
  });
});
