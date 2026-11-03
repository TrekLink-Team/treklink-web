import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ParameterService } from '../../platform/parameters/parameter.service';
import { AccountsRepository, PermissionRuleRow } from '../accounts.repository';
import { OrganizationRolePolicyRepository } from '../organization-role-policy.repository';
import { effectiveKeys, isOrganizationRole, OrganizationRoleKey } from './effective-permissions';

// Emitted after commit when a role's permissions change: by an Admin (auth task 5.3, no payload beyond
// the role, so everything is dropped) or by an organization's Manager (D-095, `organizationId`, so only
// that organization is dropped).
export const POLICY_CHANGED = 'policy.changed';

export interface PolicyChangedEvent {
  roleId?: string;
  organizationId?: string;
}

// A role holds every permission of the role it inherits from (FR-AUTH-10, REQ-UBI-05).
export const INHERITED_ROLES: Readonly<Record<string, readonly string[]>> = {
  ADMIN: ['STAFF'],
  ORG_MANAGER: ['ORG_OPERATOR'],
};

// Used when the parameter cannot be read, so a failed read never serves rows for longer than this.
const FALLBACK_TTL_SECONDS = 30;

interface Entry<V> {
  value: Promise<V>;
  readAt: number;
}

// Permission rows per role key, read once and kept until policy.changed or until
// auth.permissionCacheTtlSeconds pass (specs/auth/design.md §3, §9.4). The version counts the
// invalidations of the whole cache; access tokens carry it as `pv`, so a token shows which policy it was
// issued under. A permission change applies on the next request on the same instance, and within the
// time-to-live on another (FR-AUTH-06, REQ-EVT-08, AC-03). An organization role is kept by
// (organizationId, roleKey) and holds the effective set of that organization (D-095).
@Injectable()
export class PermissionCache {
  private readonly byRole = new Map<string, Entry<PermissionRuleRow[]>>();
  private readonly byKeys = new Map<string, Entry<PermissionRuleRow[]>>();
  private readonly byOrganization = new Map<string, Entry<PermissionRuleRow[]>>();
  private policyVersion = 0;

  constructor(
    private readonly accounts: AccountsRepository,
    private readonly policies: OrganizationRolePolicyRepository,
    private readonly parameters: ParameterService,
  ) {}

  get version(): number {
    return this.policyVersion;
  }

  // The rules of the roles and of every role they inherit, each role read once. An organization role of
  // a member is read as its organization's effective set; a TrekLink role, and an organization role
  // with no organization, as the baseline rows.
  async rulesFor(
    roleKeys: readonly string[],
    organizationId: string | null = null,
  ): Promise<PermissionRuleRow[]> {
    const organizationRoles = new Set<OrganizationRoleKey>();
    const keys = new Set<string>();
    for (const key of roleKeys) {
      if (organizationId !== null && isOrganizationRole(key)) {
        organizationRoles.add(key);
        continue;
      }
      keys.add(key);
      for (const inherited of INHERITED_ROLES[key] ?? []) keys.add(inherited);
    }
    const [perRole, perOrganization] = await Promise.all([
      Promise.all([...keys].map((key) => this.forRole(key))),
      Promise.all(
        [...organizationRoles].map((role) => this.forOrganizationRole(organizationId!, role)),
      ),
    ]);
    return [...perRole.flat(), ...this.distinct(perOrganization.flat())];
  }

  // The rows of these permission keys, read once per key set: the fixed ability of an API key holds
  // permissions by key, not by role (auth task 4.3).
  rulesForKeys(permissionKeys: readonly string[]): Promise<PermissionRuleRow[]> {
    const cacheKey = [...permissionKeys].sort().join(',');
    return this.entry(this.byKeys, cacheKey, () =>
      this.accounts.findPermissionRules(permissionKeys),
    );
  }

  // An Admin change carries no organization: everything goes and the version counts it. A change of one
  // organization drops only its entries and leaves the version alone, because no token depends on it
  // (D-060 is unchanged).
  @OnEvent(POLICY_CHANGED)
  invalidate(event?: PolicyChangedEvent): void {
    if (event?.organizationId) {
      const prefix = `${event.organizationId}:`;
      for (const key of this.byOrganization.keys()) {
        if (key.startsWith(prefix)) this.byOrganization.delete(key);
      }
      return;
    }
    this.byRole.clear();
    this.byKeys.clear();
    this.byOrganization.clear();
    this.policyVersion += 1;
  }

  private forRole(key: string): Promise<PermissionRuleRow[]> {
    return this.entry(this.byRole, key, () => this.accounts.findRolePermissions(key));
  }

  // D-095, design 9.3: the baselines of both organization roles are shared with every other
  // organization through byRole, and the stored difference is read per organization and role.
  private forOrganizationRole(
    organizationId: string,
    role: OrganizationRoleKey,
  ): Promise<PermissionRuleRow[]> {
    return this.entry(this.byOrganization, `${organizationId}:${role}`, async () => {
      const [manager, operator, stored] = await Promise.all([
        this.forRole('ORG_MANAGER'),
        this.forRole('ORG_OPERATOR'),
        this.policies.findStored(organizationId, role),
      ]);
      const rowOf = new Map([...operator, ...manager].map((row) => [row.key, row]));
      const keys = effectiveKeys(
        role,
        {
          manager: new Set(manager.map((row) => row.key)),
          operator: new Set(operator.map((row) => row.key)),
        },
        stored,
      );
      return [...keys].sort().flatMap((key) => rowOf.get(key) ?? []);
    });
  }

  private distinct(rows: PermissionRuleRow[]): PermissionRuleRow[] {
    return [...new Map(rows.map((row) => [row.key, row])).values()];
  }

  // One read per key and time-to-live. A failed read is not cached; the next request tries again.
  private async entry(
    map: Map<string, Entry<PermissionRuleRow[]>>,
    key: string,
    load: () => Promise<PermissionRuleRow[]>,
  ): Promise<PermissionRuleRow[]> {
    const ttlMs = (await this.ttlSeconds()) * 1000;
    const hit = map.get(key);
    if (hit && Date.now() - hit.readAt < ttlMs) return hit.value;
    const created: Entry<PermissionRuleRow[]> = { value: load(), readAt: Date.now() };
    created.value.catch(() => {
      if (map.get(key) === created) map.delete(key);
    });
    map.set(key, created);
    return created.value;
  }

  private async ttlSeconds(): Promise<number> {
    try {
      return await this.parameters.get('auth.permissionCacheTtlSeconds');
    } catch {
      return FALLBACK_TTL_SECONDS;
    }
  }
}
