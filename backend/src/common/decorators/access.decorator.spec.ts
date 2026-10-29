import { ExecutionContext } from '@nestjs/common';
import { abilityOf } from './access.decorator';

describe('abilityOf', () => {
  it('returns the ability JwtAuthGuard set on the request user', () => {
    const ability = { can: () => true };
    const context = {
      switchToHttp: () => ({ getRequest: () => ({ user: { ability } }) }),
    } as unknown as ExecutionContext;
    expect(abilityOf(undefined, context)).toBe(ability);
  });
});
