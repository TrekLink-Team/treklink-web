import { OrganizationRoleEffect } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OrganizationRolePolicyRepository } from './organization-role-policy.repository';

// D-095, specs/auth/design.md section 9: what one organization changed in the permissions of its two
// roles. The rules are in organization-role-policy.service.spec.ts, which mocks this class; this file
// asserts the reads, the lock-or-create of the policy row and the replace inside the transaction.

const AT = new Date('2026-11-20T03:00:00.000Z');
const { GRANT, REVOKE } = OrganizationRoleEffect;

const permission = (effect: OrganizationRoleEffect, key: string) => ({
  effect,
  permission: { key },
});

const sqlOf = (mock: jest.Mock) =>
  (mock.mock.calls[0] as [TemplateStringsArray])[0].join('?').replace(/\s+/g, ' ').trim();

const aClient = () => ({
  $executeRaw: jest.fn().mockResolvedValue(1),
  $queryRaw: jest.fn().mockResolvedValue([{ version: 3 }]),
  organizationRolePolicy: {
    findFirst: jest.fn().mockResolvedValue(null),
    update: jest.fn().mockResolvedValue({ version: 4 }),
  },
  role: { findUnique: jest.fn().mockResolvedValue({ id: 'r-1', key: 'ORG_STAFF' }) },
  organizationRolePermission: {
    deleteMany: jest.fn().mockResolvedValue({ count: 2 }),
    createMany: jest.fn().mockResolvedValue({ count: 2 }),
  },
});

describe('OrganizationRolePolicyRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: OrganizationRolePolicyRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new OrganizationRolePolicyRepository(prisma as unknown as PrismaService);
  });

  describe('findStored', () => {
    it('reads the policy of the organization and role key, with the effect of each permission', async () => {
      await repository.findStored('org-1', 'ORG_STAFF');
      expect(prisma.organizationRolePolicy.findFirst).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', role: { key: 'ORG_STAFF' } },
        select: {
          version: true,
          updatedAt: true,
          permissions: { select: { effect: true, permission: { select: { key: true } } } },
        },
      });
    });

    it('splits the rows into sorted grants and revokes, with the version and update time', async () => {
      prisma.organizationRolePolicy.findFirst.mockResolvedValue({
        version: 5,
        updatedAt: AT,
        permissions: [
          permission(REVOKE, 'incident.close'),
          permission(GRANT, 'rental.read'),
          permission(GRANT, 'incident.read'),
          permission(REVOKE, 'device.read'),
        ],
      });
      await expect(repository.findStored('org-1', 'ORG_STAFF')).resolves.toEqual({
        grants: ['incident.read', 'rental.read'],
        revokes: ['device.read', 'incident.close'],
        version: 5,
        updatedAt: AT,
      });
    });

    it('answers version 0 and no difference for a role the organization never changed', async () => {
      await expect(repository.findStored('org-1', 'ORG_STAFF', tx as never)).resolves.toEqual({
        grants: [],
        revokes: [],
        version: 0,
        updatedAt: null,
      });
      expect(tx.organizationRolePolicy.findFirst).toHaveBeenCalledTimes(1);
      expect(prisma.organizationRolePolicy.findFirst).not.toHaveBeenCalled();
    });
  });

  describe('findRoleByKey', () => {
    it('reads the id and key of the role, or null', async () => {
      await expect(repository.findRoleByKey('ORG_STAFF')).resolves.toEqual({
        id: 'r-1',
        key: 'ORG_STAFF',
      });
      expect(prisma.role.findUnique).toHaveBeenCalledWith({
        where: { key: 'ORG_STAFF' },
        select: { id: true, key: true },
      });
      prisma.role.findUnique.mockResolvedValue(null);
      await expect(repository.findRoleByKey('NOPE')).resolves.toBeNull();
    });
  });

  describe('lockVersion', () => {
    it('creates the row at version 0 if missing, then locks it and returns its version', async () => {
      await expect(repository.lockVersion('org-1', 'r-1', tx as never)).resolves.toBe(3);

      expect(sqlOf(tx.$executeRaw)).toContain('INSERT INTO "organization_role_policies"');
      expect(sqlOf(tx.$executeRaw)).toContain(
        'ON CONFLICT ("organizationId", "roleId") DO NOTHING',
      );
      expect((tx.$executeRaw.mock.calls[0] as unknown[]).slice(1)).toEqual(['org-1', 'r-1']);

      expect(sqlOf(tx.$queryRaw)).toContain('SELECT "version" FROM "organization_role_policies"');
      expect(sqlOf(tx.$queryRaw)).toMatch(/FOR UPDATE$/);
      expect((tx.$queryRaw.mock.calls[0] as unknown[]).slice(1)).toEqual(['org-1', 'r-1']);

      expect(tx.$executeRaw.mock.invocationCallOrder[0]).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[0],
      );
      expect(prisma.$executeRaw).not.toHaveBeenCalled();
    });
  });

  describe('replaceStored', () => {
    it('deletes the old rows, writes the new ones, then counts the save', async () => {
      const rows = [
        { permissionId: 'p-1', effect: GRANT },
        { permissionId: 'p-2', effect: REVOKE },
      ];
      await expect(
        repository.replaceStored('org-1', 'r-1', rows, 'manager-1', tx as never),
      ).resolves.toBe(4);
      expect(tx.organizationRolePermission.deleteMany).toHaveBeenCalledWith({
        where: { organizationId: 'org-1', roleId: 'r-1' },
      });
      expect(tx.organizationRolePermission.createMany).toHaveBeenCalledWith({
        data: [
          { organizationId: 'org-1', roleId: 'r-1', permissionId: 'p-1', effect: GRANT },
          { organizationId: 'org-1', roleId: 'r-1', permissionId: 'p-2', effect: REVOKE },
        ],
      });
      expect(tx.organizationRolePolicy.update).toHaveBeenCalledWith({
        where: { organizationId_roleId: { organizationId: 'org-1', roleId: 'r-1' } },
        data: { version: { increment: 1 }, updatedById: 'manager-1' },
        select: { version: true },
      });
      const order = [
        tx.organizationRolePermission.deleteMany,
        tx.organizationRolePermission.createMany,
        tx.organizationRolePolicy.update,
      ].map((mock) => mock.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('writes no rows for a reset to the baseline, and still counts the save', async () => {
      await expect(
        repository.replaceStored('org-1', 'r-1', [], 'manager-1', tx as never),
      ).resolves.toBe(4);
      expect(tx.organizationRolePermission.deleteMany).toHaveBeenCalledTimes(1);
      expect(tx.organizationRolePermission.createMany).not.toHaveBeenCalled();
      expect(tx.organizationRolePolicy.update).toHaveBeenCalledTimes(1);
    });
  });
});
