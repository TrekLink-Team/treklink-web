import { HttpStatus } from '@nestjs/common';
import { subject } from '@casl/ability';
import { DomainException, ErrorCode } from '../../common/errors';
import { AppAbility } from './casl/ability.factory';
import { forbidden } from './guards/policies.guard';
import { AuthUser } from './strategies/jwt.strategy';

// The organization filter every repository method that serves an organization takes
// (specs/auth/design.md §3, FR-AUTH-11, BR-19): no filter for a TrekLink account, the caller's own
// organization for a member. The organization comes from the verified token, never the request.
export const scopeWhere = (
  caller: Pick<AuthUser, 'accountType' | 'organization'>,
): { organizationId?: string } => {
  if (caller.accountType === 'TREKLINK') return {};
  if (!caller.organization) throw forbidden();
  return { organizationId: caller.organization.id };
};

// Record-level check after loading a row (scoped 404 rule, platform design §4.2, REQ-ERR-06):
// a row the caller's own condition does not match answers 404, as if it did not exist, so another
// organization's records cannot be probed; a caller without the permission at all gets 403.
export const assertOwnOr404 = (
  ability: AppAbility,
  action: string,
  subjectType: string,
  row: Record<string, unknown>,
  notFoundMessage = `${subjectType} not found.`,
): void => {
  if (ability.can(action, subject(subjectType, { ...row }))) return;
  if (ability.can(action, subjectType)) {
    throw new DomainException(HttpStatus.NOT_FOUND, ErrorCode.NOT_FOUND, notFoundMessage);
  }
  throw forbidden();
};
