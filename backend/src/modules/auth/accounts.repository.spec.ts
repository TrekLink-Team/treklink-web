import { AccountType, AuthEventType, OtpPurpose, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import {
  ACCOUNT_SELECT,
  AccountsRepository,
  ADMIN_CHANGES_LOCK,
  ACCOUNT_VIEW_SELECT,
  CATALOG_PERMISSION_SELECT,
  normalizeEmail,
  ONE_TIME_CODE_SELECT,
  PERMISSION_RULE_SELECT,
} from './accounts.repository';

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
    rolePermission: { findMany: jest.Mock };
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
      rolePermission: { findMany: jest.fn() },
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

  it('reads the permission rows granted to a role key (auth task 4.1)', async () => {
    const row = { key: 'incident.read', action: 'read', subject: 'Incident' };
    prisma.rolePermission.findMany.mockResolvedValue([{ permission: row }]);

    await expect(repository.findRolePermissions('STAFF')).resolves.toEqual([row]);
    expect(prisma.rolePermission.findMany).toHaveBeenCalledWith({
      where: { role: { key: 'STAFF' } },
      select: { permission: { select: PERMISSION_RULE_SELECT } },
    });
  });
});

describe('AccountsRepository, codes and passwords (auth tasks 3.1, 3.2)', () => {
  let prisma: {
    user: { update: jest.Mock; findMany: jest.Mock };
    refreshToken: { updateMany: jest.Mock };
    oneTimeCode: Record<string, jest.Mock>;
  };
  let repository: AccountsRepository;

  beforeEach(() => {
    prisma = {
      user: {
        update: jest.fn().mockResolvedValue(undefined),
        findMany: jest.fn().mockResolvedValue([{ id: 'user-1', fullName: 'Tran Thi B' }]),
      },
      refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
      oneTimeCode: {
        findFirst: jest.fn().mockResolvedValue(null),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        create: jest.fn().mockResolvedValue(undefined),
        update: jest.fn().mockResolvedValue(undefined),
      },
    };
    repository = new AccountsRepository(prisma as unknown as PrismaService);
  });

  it('revokes every live refresh token of the account and stores a new hash', async () => {
    await repository.revokeAllUserTokens('user-1', NOW);
    expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: NOW },
    });

    await repository.setPasswordHash('user-1', '$2b$04$new');
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: '$2b$04$new' },
    });
  });

  it('reads when the account was last sent a code of any purpose', async () => {
    await expect(repository.lastCodeSentAt('user-1')).resolves.toBeNull();

    prisma.oneTimeCode.findFirst.mockResolvedValue({ createdAt: NOW });
    await expect(repository.lastCodeSentAt('user-1')).resolves.toBe(NOW);
    expect(prisma.oneTimeCode.findFirst).toHaveBeenLastCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
  });

  it('spends the live codes of a purpose, then stores a new one', async () => {
    await repository.consumeLiveCodes('user-1', OtpPurpose.PASSWORD_RESET, NOW);
    expect(prisma.oneTimeCode.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', purpose: OtpPurpose.PASSWORD_RESET, consumedAt: null },
      data: { consumedAt: NOW },
    });

    const code = {
      userId: 'user-1',
      purpose: OtpPurpose.PASSWORD_RESET,
      codeHash: 'abc',
      expiresAt: NOW,
    };
    await repository.createCode(code);
    expect(prisma.oneTimeCode.create).toHaveBeenCalledWith({ data: code });
  });

  it('reads the newest live code of a purpose and spends an attempt on it atomically', async () => {
    await repository.findLiveCode('user-1', OtpPurpose.SET_PASSWORD);
    expect(prisma.oneTimeCode.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', purpose: OtpPurpose.SET_PASSWORD, consumedAt: null },
      orderBy: { createdAt: 'desc' },
      select: ONE_TIME_CODE_SELECT,
    });

    await expect(repository.spendAttempt('otp-1', 5, NOW)).resolves.toBe(true);
    expect(prisma.oneTimeCode.updateMany).toHaveBeenLastCalledWith({
      where: { id: 'otp-1', consumedAt: null, expiresAt: { gt: NOW }, attempts: { lt: 5 } },
      data: { attempts: { increment: 1 } },
    });

    prisma.oneTimeCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.spendAttempt('otp-1', 5, NOW)).resolves.toBe(false);
  });

  it('consumes a code only while it is live, so one code cannot be used twice', async () => {
    await expect(repository.consumeCode('otp-1', NOW)).resolves.toBe(true);
    expect(prisma.oneTimeCode.updateMany).toHaveBeenCalledWith({
      where: { id: 'otp-1', consumedAt: null },
      data: { consumedAt: NOW },
    });

    prisma.oneTimeCode.updateMany.mockResolvedValue({ count: 0 });
    await expect(repository.consumeCode('otp-1', NOW)).resolves.toBe(false);
  });

  it('maps account ids to full names for the ACCOUNT_DIRECTORY port', async () => {
    await expect(repository.namesOf(['user-1', 'user-9'])).resolves.toEqual(
      new Map([['user-1', 'Tran Thi B']]),
    );
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { id: { in: ['user-1', 'user-9'] } },
      select: { id: true, fullName: true },
    });
  });
});

describe('AccountsRepository, TrekLink accounts and roles (auth tasks 5.1, 5.3)', () => {
  const viewRow = {
    id: 'staff-1',
    email: 'staff@treklink.vn',
    fullName: 'Tran Thi B',
    phoneNumber: null,
    accountType: AccountType.TREKLINK,
    isActive: true,
    lastLoginAt: null,
    createdAt: NOW,
    roles: [{ role: { key: 'STAFF' } }],
  };
  const roleRow = {
    id: 'r-1',
    key: 'STAFF',
    accountType: AccountType.TREKLINK,
    isSystem: true,
    permissions: [{ permission: { key: 'incident.read' } }, { permission: { key: 'device.read' } }],
  };
  let prisma: {
    user: Record<string, jest.Mock>;
    role: Record<string, jest.Mock>;
    userRole: Record<string, jest.Mock>;
    permission: { findMany: jest.Mock };
    rolePermission: Record<string, jest.Mock>;
  };
  let repository: AccountsRepository;
  const tx = { $executeRaw: jest.fn().mockResolvedValue(1) };

  beforeEach(() => {
    prisma = {
      user: {
        findMany: jest.fn().mockResolvedValue([viewRow]),
        findFirst: jest.fn().mockResolvedValue(viewRow),
        count: jest.fn().mockResolvedValue(1),
        update: jest.fn().mockResolvedValue(undefined),
      },
      role: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'r-admin' }),
        findMany: jest.fn().mockResolvedValue([roleRow]),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      userRole: {
        deleteMany: jest.fn().mockResolvedValue(undefined),
        create: jest.fn().mockResolvedValue(undefined),
      },
      permission: { findMany: jest.fn().mockResolvedValue([]) },
      rolePermission: {
        deleteMany: jest.fn().mockResolvedValue(undefined),
        createMany: jest.fn().mockResolvedValue(undefined),
      },
    };
    repository = new AccountsRepository(prisma as unknown as PrismaService);
  });

  it('pages TrekLink accounts newest first, filtered by the query and the active flag', async () => {
    await expect(
      repository.pageTreklinkAccounts({ q: 'tran', isActive: false }, 20, 10),
    ).resolves.toEqual([[{ ...viewRow, roles: ['STAFF'] }], 1]);
    const where = {
      accountType: AccountType.TREKLINK,
      deletedAt: null,
      isActive: false,
      OR: [
        { fullName: { contains: 'tran', mode: 'insensitive' } },
        { email: { contains: 'tran', mode: 'insensitive' } },
      ],
    };
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: 20,
      take: 10,
      select: ACCOUNT_VIEW_SELECT,
    });
    expect(prisma.user.count).toHaveBeenCalledWith({ where });

    await repository.pageTreklinkAccounts({}, 0, 10);
    expect(prisma.user.count).toHaveBeenLastCalledWith({
      where: { accountType: AccountType.TREKLINK, deletedAt: null },
    });
  });

  it('finds a TrekLink account that is not deleted', async () => {
    await expect(repository.findTreklinkAccount('staff-1')).resolves.toMatchObject({
      roles: ['STAFF'],
    });
    expect(prisma.user.findFirst).toHaveBeenCalledWith({
      where: { id: 'staff-1', accountType: AccountType.TREKLINK, deletedAt: null },
      select: ACCOUNT_VIEW_SELECT,
    });

    prisma.user.findFirst.mockResolvedValue(null);
    await expect(repository.findTreklinkAccount('member-1')).resolves.toBeNull();
  });

  it('updates the profile and the active flag', async () => {
    await repository.updateProfile('staff-1', { fullName: 'Tran Thi C' });
    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'staff-1' },
      data: { fullName: 'Tran Thi C' },
    });

    await repository.setActive('staff-1', false);
    expect(prisma.user.update).toHaveBeenLastCalledWith({
      where: { id: 'staff-1' },
      data: { isActive: false },
    });
  });

  it('replaces the role of a TrekLink account with the given one', async () => {
    await repository.replaceRole('staff-1', 'ADMIN', 'admin-1');

    expect(prisma.role.findUniqueOrThrow).toHaveBeenCalledWith({
      where: { key: 'ADMIN' },
      select: { id: true },
    });
    expect(prisma.userRole.deleteMany).toHaveBeenCalledWith({ where: { userId: 'staff-1' } });
    expect(prisma.userRole.create).toHaveBeenCalledWith({
      data: { userId: 'staff-1', roleId: 'r-admin', grantedById: 'admin-1' },
    });
  });

  it('takes the advisory lock of the last-Admin guard and counts active Admins', async () => {
    await repository.lockAdminChanges(tx as unknown as Prisma.TransactionClient);
    const [sql, key] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toBe('SELECT pg_advisory_xact_lock(hashtext(?))');
    expect(key).toBe(ADMIN_CHANGES_LOCK);

    await expect(repository.countActiveAdmins()).resolves.toBe(1);
    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { isActive: true, deletedAt: null, roles: { some: { role: { key: 'ADMIN' } } } },
    });
  });

  it('reads roles with sorted permission keys', async () => {
    await expect(repository.listRoles()).resolves.toEqual([
      {
        id: 'r-1',
        key: 'STAFF',
        accountType: AccountType.TREKLINK,
        isSystem: true,
        permissionKeys: ['device.read', 'incident.read'],
      },
    ]);
    expect(prisma.role.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { key: 'asc' } }),
    );

    await expect(repository.findRole('r-x')).resolves.toBeNull();
    prisma.role.findUnique.mockResolvedValue(roleRow);
    await expect(repository.findRole('r-1')).resolves.toMatchObject({ key: 'STAFF' });
  });

  it('reads the catalog, all of it or by keys, and replaces a role permission set', async () => {
    await repository.listPermissions();
    expect(prisma.permission.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { key: 'asc' },
      select: CATALOG_PERMISSION_SELECT,
    });
    await repository.listPermissions(['role.manage']);
    expect(prisma.permission.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { key: { in: ['role.manage'] } } }),
    );

    await repository.replaceRolePermissions(
      'r-1',
      ['p-1', 'p-2'],
      prisma as unknown as Prisma.TransactionClient,
    );
    expect(prisma.rolePermission.deleteMany).toHaveBeenCalledWith({ where: { roleId: 'r-1' } });
    expect(prisma.rolePermission.createMany).toHaveBeenCalledWith({
      data: [
        { roleId: 'r-1', permissionId: 'p-1' },
        { roleId: 'r-1', permissionId: 'p-2' },
      ],
    });
  });
});
