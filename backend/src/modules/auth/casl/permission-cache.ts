import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AccountsRepository, PermissionRuleRow } from '../accounts.repository';

// Emitted after commit when an Admin replaces a role's permissions (auth task 5.3).
export const POLICY_CHANGED = 'policy.changed';

// A role holds every permission of the role it inherits from (FR-AUTH-10, REQ-UBI-05).
export const INHERITED_ROLES: Readonly<Record<string, readonly string[]>> = {
  ADMIN: ['STAFF'],
  ORG_MANAGER: ['ORG_OPERATOR'],
};

// Permission rows per role key, read once and kept until policy.changed (specs/auth/design.md §3).
// The version counts the invalidations; access tokens carry it as `pv`, so a token shows which
// policy it was issued under. A permission change applies on the next request without a redeploy
// (FR-AUTH-06, REQ-EVT-08, AC-03).
@Injectable()
export class PermissionCache {
  private readonly byRole = new Map<string, Promise<PermissionRuleRow[]>>();
  private readonly byKeys = new Map<string, Promise<PermissionRuleRow[]>>();
  private policyVersion = 0;

  constructor(private readonly accounts: AccountsRepository) {}

  get version(): number {
    return this.policyVersion;
  }

  // The rules of the roles and of every role they inherit, each role read once.
  async rulesFor(roleKeys: readonly string[]): Promise<PermissionRuleRow[]> {
    const keys = new Set<string>();
    for (const key of roleKeys) {
      keys.add(key);
      for (const inherited of INHERITED_ROLES[key] ?? []) keys.add(inherited);
    }
    const perRole = await Promise.all([...keys].map((key) => this.forRole(key)));
    return perRole.flat();
  }

  // The rows of these permission keys, read once per key set: the fixed ability of an API key holds
  // permissions by key, not by role (auth task 4.3).
  rulesForKeys(permissionKeys: readonly string[]): Promise<PermissionRuleRow[]> {
    const cacheKey = [...permissionKeys].sort().join(',');
    let rows = this.byKeys.get(cacheKey);
    if (!rows) {
      rows = this.accounts.findPermissionRules(permissionKeys);
      rows.catch(() => this.byKeys.delete(cacheKey));
      this.byKeys.set(cacheKey, rows);
    }
    return rows;
  }

  @OnEvent(POLICY_CHANGED)
  invalidate(): void {
    this.byRole.clear();
    this.byKeys.clear();
    this.policyVersion += 1;
  }

  private forRole(key: string): Promise<PermissionRuleRow[]> {
    let rows = this.byRole.get(key);
    if (!rows) {
      rows = this.accounts.findRolePermissions(key);
      // A failed read is not cached; the next request tries again.
      rows.catch(() => this.byRole.delete(key));
      this.byRole.set(key, rows);
    }
    return rows;
  }
}
