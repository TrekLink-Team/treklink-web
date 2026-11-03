import { Injectable } from '@nestjs/common';
import { OrganizationRoleEffect, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { PolicyDelta } from './casl/effective-permissions';

type Client = Prisma.TransactionClient | PrismaService;

export interface StoredPolicy extends PolicyDelta {
  version: number;
  updatedAt: Date | null;
}

export interface RoleRef {
  id: string;
  key: string;
}

// What one organization changed in the permissions of its two roles (D-095, specs/auth/design.md §9).
// A role with no row has version 0 and no difference from the baseline.
@Injectable()
export class OrganizationRolePolicyRepository {
  constructor(private readonly prisma: PrismaService) {}

  // The stored difference of one organization and role, as permission keys.
  async findStored(
    organizationId: string,
    roleKey: string,
    client: Client = this.prisma,
  ): Promise<StoredPolicy> {
    const policy = await client.organizationRolePolicy.findFirst({
      where: { organizationId, role: { key: roleKey } },
      select: {
        version: true,
        updatedAt: true,
        permissions: { select: { effect: true, permission: { select: { key: true } } } },
      },
    });
    if (!policy) return { grants: [], revokes: [], version: 0, updatedAt: null };
    const keysOf = (effect: OrganizationRoleEffect): string[] =>
      policy.permissions
        .filter((row) => row.effect === effect)
        .map((row) => row.permission.key)
        .sort();
    return {
      grants: keysOf(OrganizationRoleEffect.GRANT),
      revokes: keysOf(OrganizationRoleEffect.REVOKE),
      version: policy.version,
      updatedAt: policy.updatedAt,
    };
  }

  async findRoleByKey(key: string, client: Client = this.prisma): Promise<RoleRef | null> {
    return client.role.findUnique({ where: { key }, select: { id: true, key: true } });
  }

  // Locks the policy row of one organization and role and returns its version, creating the row at
  // version 0 when the role has none. The insert and the lock belong to the caller's transaction, so a
  // refused save leaves no row behind.
  async lockVersion(
    organizationId: string,
    roleId: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    await tx.$executeRaw`
      INSERT INTO "organization_role_policies" ("organizationId", "roleId", "version", "updatedAt")
      VALUES (${organizationId}, ${roleId}, 0, CURRENT_TIMESTAMP)
      ON CONFLICT ("organizationId", "roleId") DO NOTHING`;
    const rows = await tx.$queryRaw<{ version: number }[]>`
      SELECT "version" FROM "organization_role_policies"
      WHERE "organizationId" = ${organizationId} AND "roleId" = ${roleId}
      FOR UPDATE`;
    return rows[0].version;
  }

  // Replaces the stored rows of the policy and counts the save.
  async replaceStored(
    organizationId: string,
    roleId: string,
    rows: readonly { permissionId: string; effect: OrganizationRoleEffect }[],
    updatedById: string,
    tx: Prisma.TransactionClient,
  ): Promise<number> {
    await tx.organizationRolePermission.deleteMany({ where: { organizationId, roleId } });
    if (rows.length > 0) {
      await tx.organizationRolePermission.createMany({
        data: rows.map((row) => ({ organizationId, roleId, ...row })),
      });
    }
    const saved = await tx.organizationRolePolicy.update({
      where: { organizationId_roleId: { organizationId, roleId } },
      data: { version: { increment: 1 }, updatedById },
      select: { version: true },
    });
    return saved.version;
  }
}
