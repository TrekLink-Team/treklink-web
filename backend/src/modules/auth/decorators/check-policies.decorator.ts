import { SetMetadata } from '@nestjs/common';
import { AppAbility } from '../casl/ability.factory';

export const CHECK_POLICIES_KEY = 'treklink:checkPolicies';

export type PolicyHandler = (ability: AppAbility) => boolean;

// The type-level permission a handler needs, evaluated by PoliciesGuard after JwtAuthGuard, for
// example `@CheckPolicies((ability) => ability.can('decide', 'Organization'))` (specs/auth/design.md
// §3). Every handler must pass. Record-level `own` checks use `assertOwnOr404` after loading the row.
export const CheckPolicies = (...handlers: PolicyHandler[]) =>
  SetMetadata(CHECK_POLICIES_KEY, handlers);
