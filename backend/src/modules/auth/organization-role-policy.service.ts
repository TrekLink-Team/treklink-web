import { HttpStatus, Inject, Injectable, Optional } from '@nestjs/common';
import { OrganizationRoleEffect } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD, AuditRecordEvent } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AccountsRepository, PermissionRuleRow } from './accounts.repository';
import {
  Baselines,
  effectiveKeys,
  isOrganizationRole,
  MANAGER_PROTECTED,
  ORGANIZATION_ROLES,
  OrganizationRoleKey,
} from './casl/effective-permissions';
import { POLICY_CHANGED, PolicyChangedEvent } from './casl/permission-cache';
import { OrganizationRolePolicyRepository } from './organization-role-policy.repository';
import { ACCOUNT_CONTEXT_PROVIDER, AccountContextProvider } from './ports/account-context.port';
import { CatalogPermission, scopeOf } from './roles.service';
import { ClientInfo } from './token.service';

export interface OrganizationRoleView {
  key: OrganizationRoleKey;
  version: number;
  baselineKeys: string[];
  effectiveKeys: string[];
}

export interface OrganizationRolesResult {
  roles: OrganizationRoleView[];
  catalog: CatalogPermission[];
}

export interface OrganizationRoleSaved {
  key: OrganizationRoleKey;
  version: number;
  effectiveKeys: string[];
}

const sorted = (keys: Iterable<string>): string[] => [...new Set(keys)].sort();

// What the Manager of an organization may change in the permissions of its two roles (auth task 9.3,
// specs/auth/design.md §9, api-design 19 and 20). The organization comes from the verified caller, never
// from the request (REQ-UBI-06).
@Injectable()
export class OrganizationRolePolicyService {
  constructor(
    private readonly accounts: AccountsRepository,
    private readonly policies: OrganizationRolePolicyRepository,
    private readonly events: TransactionalEvents,
    @Optional()
    @Inject(ACCOUNT_CONTEXT_PROVIDER)
    private readonly context?: AccountContextProvider,
  ) {}

  // The two roles with their baseline, effective keys and version, and the permissions inside the
  // ceiling (api-design 19). A read, allowed while the organization is not ACTIVE.
  async view(caller: Caller): Promise<OrganizationRolesResult> {
    const { organizationId } = await this.membership(caller);
    return this.viewOf(organizationId);
  }

  // The same view for a named organization, for the read-only page of TrekLink Staff and Admin
  // (organizations api-design 33). The caller has been checked by the route; an unknown organization
  // reads as both roles at their baseline, so the route confirms the organization exists first.
  async viewOf(organizationId: string): Promise<OrganizationRolesResult> {
    const { baselines, rows } = await this.baselines();
    const roles = await Promise.all(
      ORGANIZATION_ROLES.map(async (key): Promise<OrganizationRoleView> => {
        const stored = await this.policies.findStored(organizationId, key);
        return {
          key,
          version: stored.version,
          baselineKeys: sorted(key === 'ORG_MANAGER' ? baselines.manager : baselines.operator),
          effectiveKeys: sorted(effectiveKeys(key, baselines, stored)),
        };
      }),
    );
    const catalog = [...rows.values()]
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((row): CatalogPermission => ({
        key: row.key,
        action: row.action,
        subject: row.subject,
        scope: scopeOf(row.conditions),
        accountType: 'ORGANIZATION',
        description: null,
        protected: MANAGER_PROTECTED.includes(row.key),
      }));
    return { roles, catalog };
  }

  // Replaces the effective set of one role: the sent list is compared with the baseline, the difference
  // is stored as grants and revokes, and the change applies from the next request (REQ-EVT-10). The
  // Manager keeps every permission of the Operator baseline and the protected permission whatever the
  // list says (REQ-UBI-10, REQ-UBI-12).
  async replace(
    caller: Caller,
    roleKey: string,
    requestedKeys: readonly string[],
    expectedVersion: number,
    client: ClientInfo,
  ): Promise<OrganizationRoleSaved> {
    if (!isOrganizationRole(roleKey)) throw this.roleNotFound();
    const { organizationId, organizationStatus } = await this.membership(caller);
    // A refusal before the transaction costs no lock; the status is read again under a lock below.
    this.requireActive(organizationStatus);
    const keys = sorted(requestedKeys);

    return this.events.transaction(async (tx) => {
      // The organization row FOR SHARE until the save commits: a suspension or a closing that commits
      // between the read above and this write is seen here, and one that starts now waits for the save.
      const locked = await this.context?.lockOrganizationStatus(organizationId, tx);
      if (locked === null) {
        throw new DomainException(
          HttpStatus.NOT_FOUND,
          ErrorCode.NOT_FOUND,
          'Organization not found.',
        );
      }
      if (locked !== undefined) this.requireActive(locked);
      const role = await this.policies.findRoleByKey(roleKey, tx);
      if (!role) throw this.roleNotFound();

      const { baselines, rows } = await this.baselines();
      const catalog = new Map(
        (await this.accounts.listPermissions(keys, tx)).map((row) => [row.key, row]),
      );
      const unknown = keys.find((key) => !catalog.has(key));
      if (unknown) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.UNKNOWN_PERMISSION,
          `Unknown permission: ${unknown}.`,
        );
      }
      const outside = keys.find(
        (key) => !rows.has(key) || (roleKey === 'ORG_OPERATOR' && MANAGER_PROTECTED.includes(key)),
      );
      if (outside) {
        throw new DomainException(
          HttpStatus.BAD_REQUEST,
          ErrorCode.PERMISSION_OUT_OF_CEILING,
          `${outside} cannot be granted to this role.`,
        );
      }
      if (roleKey === 'ORG_MANAGER' && MANAGER_PROTECTED.some((key) => !keys.includes(key))) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.MANAGER_LOCKOUT,
          'Managers must keep the right to manage roles.',
        );
      }

      const version = await this.policies.lockVersion(organizationId, role.id, tx);
      if (version !== expectedVersion) {
        throw new DomainException(
          HttpStatus.CONFLICT,
          ErrorCode.STALE_VERSION,
          'The permissions of this role changed since you loaded them. Reload and try again.',
        );
      }

      const before = await this.policies.findStored(organizationId, roleKey, tx);
      const baseline = roleKey === 'ORG_MANAGER' ? baselines.manager : baselines.operator;
      const wanted = new Set(keys);
      if (roleKey === 'ORG_MANAGER') {
        for (const key of [...baselines.operator, ...MANAGER_PROTECTED]) wanted.add(key);
      }
      const grants = sorted([...wanted].filter((key) => !baseline.has(key)));
      const revokes = sorted([...baseline].filter((key) => !wanted.has(key)));
      const ids = new Map(
        (await this.accounts.listPermissions([...grants, ...revokes], tx)).map((row) => [
          row.key,
          row.id,
        ]),
      );
      const savedVersion = await this.policies.replaceStored(
        organizationId,
        role.id,
        [
          ...grants.map((key) => ({
            permissionId: ids.get(key)!,
            effect: OrganizationRoleEffect.GRANT,
          })),
          ...revokes.map((key) => ({
            permissionId: ids.get(key)!,
            effect: OrganizationRoleEffect.REVOKE,
          })),
        ],
        caller.id,
        tx,
      );

      const after = sorted(effectiveKeys(roleKey, baselines, { grants, revokes }));
      const previous = sorted(effectiveKeys(roleKey, baselines, before));
      this.events.emitAfterCommit(POLICY_CHANGED, { organizationId } satisfies PolicyChangedEvent);
      this.events.emitAfterCommit(AUDIT_RECORD, {
        actorId: caller.id,
        actorRoles: caller.roles,
        organizationId,
        action: 'organization.rolePermissions',
        subjectType: 'Role',
        subjectId: role.id,
        before: { roleKey, version, permissionKeys: previous },
        after: {
          roleKey,
          version: savedVersion,
          permissionKeys: after,
          granted: after.filter((key) => !previous.includes(key)),
          revoked: previous.filter((key) => !after.includes(key)),
        },
        ip: client.ip,
      } satisfies AuditRecordEvent);
      return { key: roleKey, version: savedVersion, effectiveKeys: after };
    });
  }

  // The organization and status of the caller; an account with no membership has no organization role.
  private async membership(caller: Caller) {
    const membership = (await this.context?.forUser(caller.id)) ?? null;
    if (!membership) {
      throw new DomainException(
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
        'You do not have access to this.',
      );
    }
    return membership;
  }

  // The rows of both organization roles as permission keys, and the rows inside the ceiling by key.
  private async baselines(): Promise<{
    baselines: Baselines;
    rows: Map<string, PermissionRuleRow>;
  }> {
    const [manager, operator] = await Promise.all([
      this.accounts.findRolePermissions('ORG_MANAGER'),
      this.accounts.findRolePermissions('ORG_OPERATOR'),
    ]);
    return {
      baselines: {
        manager: new Set(manager.map((row) => row.key)),
        operator: new Set(operator.map((row) => row.key)),
      },
      rows: new Map([...operator, ...manager].map((row) => [row.key, row])),
    };
  }

  private requireActive(status: string): void {
    if (status === 'ACTIVE') return;
    throw new DomainException(
      HttpStatus.CONFLICT,
      ErrorCode.ORGANIZATION_NOT_ACTIVE,
      `Role permissions cannot be changed while the organization is ${status.toLowerCase()}.`,
    );
  }

  private roleNotFound(): DomainException {
    return new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, 'Role not found.');
  }
}
