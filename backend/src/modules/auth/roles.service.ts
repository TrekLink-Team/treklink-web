import { HttpStatus, Injectable } from '@nestjs/common';
import { AccountType } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository, CatalogPermissionRow, RoleView } from './accounts.repository';
import { POLICY_CHANGED } from './casl/permission-cache';
import { ClientInfo } from './token.service';

// Permissions ADMIN may never lose (D-057 rule 2). The permission matrix marks only `role.manage`;
// the schema has no `protected` column yet (treklink-docs#98, 1).
export const PROTECTED_PERMISSIONS: ReadonlySet<string> = new Set(['role.manage']);

export interface CatalogPermission {
  key: string;
  action: string;
  subject: string;
  scope: 'own' | 'any';
  accountType: AccountType;
  description: string | null;
  protected: boolean;
}

export interface RolePermissionsResult {
  id: string;
  key: string;
  permissionCount: number;
}

const ORGANIZATION_PLACEHOLDER = '${user.organizationId}';

// `own` when the condition binds the permission to the caller's organization (D-057 rule 2).
export const scopeOf = (conditions: CatalogPermissionRow['conditions']): 'own' | 'any' =>
  conditions !== null && JSON.stringify(conditions).includes(ORGANIZATION_PLACEHOLDER)
    ? 'own'
    : 'any';

const toCatalogPermission = (row: CatalogPermissionRow): CatalogPermission => ({
  key: row.key,
  action: row.action,
  subject: row.subject,
  scope: scopeOf(row.conditions),
  accountType: row.accountType,
  description: null,
  protected: PROTECTED_PERMISSIONS.has(row.key),
});

const roleKind = (accountType: AccountType) =>
  accountType === AccountType.ORGANIZATION ? 'an organization role' : 'a TrekLink role';

// Roles and the permission catalog (auth task 5.3, api-design 15, 16 and 18, FR-AUTH-06). The
// catalog is read-only and comes from the seed; a role holds only permissions of its own account
// type. A change reaches every request after the commit, through policy.changed (AC-03).
@Injectable()
export class RolesService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly events: TransactionalEvents,
  ) {}

  list(): Promise<RoleView[]> {
    return this.accounts.listRoles();
  }

  async catalog(): Promise<CatalogPermission[]> {
    return (await this.accounts.listPermissions()).map(toCatalogPermission);
  }

  async replacePermissions(
    actor: Caller,
    roleId: string,
    requestedKeys: readonly string[],
    client: ClientInfo,
  ): Promise<RolePermissionsResult> {
    const keys = [...new Set(requestedKeys)];

    return this.events.transaction(async (tx) => {
      const role = await this.accounts.findRole(roleId, tx);
      if (!role) {
        throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Role not found.');
      }

      const rows = await this.accounts.listPermissions(keys, tx);
      const known = new Map(rows.map((row) => [row.key, row]));
      const unknown = keys.find((key) => !known.has(key));
      if (unknown) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.UNKNOWN_PERMISSION,
          `Unknown permission: ${unknown}.`,
        );
      }
      const foreign = rows.find((row) => row.accountType !== role.accountType);
      if (foreign) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.PERMISSION_SCOPE_MISMATCH,
          `${foreign.key} cannot be granted to ${roleKind(role.accountType)}.`,
        );
      }
      if (role.key === 'ADMIN' && [...PROTECTED_PERMISSIONS].some((key) => !known.has(key))) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.ADMIN_LOCKOUT,
          'Admins must keep the right to manage roles.',
        );
      }

      await this.accounts.replaceRolePermissions(
        role.id,
        rows.map((row) => row.id),
        tx,
      );
      this.events.emitAfterCommit(POLICY_CHANGED, { roleId: role.id });
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: actor.id,
        actorRoles: actor.roles,
        organizationId: null,
        action: 'role.permissions',
        subjectType: 'Role',
        subjectId: role.id,
        before: { permissionKeys: role.permissionKeys },
        after: { permissionKeys: [...keys].sort() },
        ip: client.ip,
      } satisfies AuditRecordEvent);
      return { id: role.id, key: role.key, permissionCount: rows.length };
    });
  }
}
