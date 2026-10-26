import { Injectable } from '@nestjs/common';
import { createMongoAbility, MongoAbility, RawRuleOf } from '@casl/ability';
import { PermissionRuleRow } from '../accounts.repository';
import { PermissionCache } from './permission-cache';

// Subjects are model names as strings (permission rows hold `subject`), and actions are free strings
// such as read, manage, decide (specs/auth/permission-matrix.md).
export type AppAbility = MongoAbility<[string, string | Record<string, unknown>]>;

// The values a permission condition may reference, always taken from the verified request context
// (the token or the API key), never from the request (REQ-UBI-06, FR-AUTH-11).
export interface AbilityContext {
  userId: string | null;
  organizationId: string | null;
  roles: readonly string[];
}

const PLACEHOLDER = /^\$\{user\.(id|organizationId)\}$/;

// Replaces each `${user.id}` and `${user.organizationId}` string in a condition with the context
// value. A placeholder the context cannot fill becomes null, which matches no row: a TrekLink
// account never gains an `own` rule by accident.
export const interpolate = (value: unknown, context: AbilityContext): unknown => {
  if (typeof value === 'string') {
    const match = PLACEHOLDER.exec(value);
    if (!match) return value;
    return match[1] === 'id' ? context.userId : context.organizationId;
  }
  if (Array.isArray(value)) return value.map((item) => interpolate(item, context));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, interpolate(item, context)]),
    );
  }
  return value;
};

export const toRule = (row: PermissionRuleRow, context: AbilityContext): RawRuleOf<AppAbility> => ({
  action: row.action,
  subject: row.subject,
  ...(row.conditions !== null
    ? {
        conditions: interpolate(row.conditions, context) as RawRuleOf<AppAbility>['conditions'],
      }
    : {}),
  ...(row.fields.length > 0 ? { fields: row.fields } : {}),
  ...(row.inverted ? { inverted: true } : {}),
  ...(row.reason ? { reason: row.reason } : {}),
});

// Builds the CASL ability of a caller from the permission rows of its roles (auth task 4.1,
// specs/auth/design.md §3).
@Injectable()
export class AbilityFactory {
  constructor(private readonly permissions: PermissionCache) {}

  async forContext(context: AbilityContext): Promise<AppAbility> {
    const rows = await this.permissions.rulesFor(context.roles);
    return createMongoAbility<AppAbility>(rows.map((row) => toRule(row, context)));
  }

  // The ability of an organization API key: exactly these permission rows, their `own` conditions
  // bound to the key's organization, and no role (auth task 4.3, BR-20).
  async forApiKey(organizationId: string, permissionKeys: readonly string[]): Promise<AppAbility> {
    const rows = await this.permissions.rulesForKeys(permissionKeys);
    const context: AbilityContext = { userId: null, organizationId, roles: [] };
    return createMongoAbility<AppAbility>(rows.map((row) => toRule(row, context)));
  }
}
