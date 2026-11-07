import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  CHECK_POLICIES_KEY,
  IS_PUBLIC_KEY,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { DemoQuickController, DemoQuickDto } from './demo-quick.controller';
import { DemoQuickService } from './demo-quick.service';

describe('DemoQuickController', () => {
  it.each(['options', 'run'] as const)('requires a JWT and stage policy for %s', (name) => {
    const handler = Object.getOwnPropertyDescriptor(DemoQuickController.prototype, name)!
      .value as object;
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
    const policies = Reflect.getMetadata(CHECK_POLICIES_KEY, handler) as PolicyHandler[];
    expect(policies.length).toBeGreaterThan(0);
    const can = jest.fn(() => true);
    expect(policies.every((policy) => policy({ can }))).toBe(true);
    expect(can).toHaveBeenCalledWith('stage', 'Demo');
    expect(policies.every((policy) => policy({ can: () => false }))).toBe(false);
  });
  it('passes the verified caller to both service calls', () => {
    const quick = { options: jest.fn(), run: jest.fn() };
    const controller = new DemoQuickController(quick as unknown as DemoQuickService);
    const actor = { id: 'admin', roles: ['ADMIN'], organizationId: null };
    void controller.options(actor);
    void controller.run('organization', {}, actor);
    expect(quick.options).toHaveBeenCalledWith(actor);
    expect(quick.run).toHaveBeenCalledWith('organization', {}, actor);
  });
  it.each([
    { quantity: 0 },
    { quantity: 1.5 },
    { recordId: 'bad' },
    { target: 'CLOSED' },
    { active: 'true' },
    { expectedVersion: -1 },
  ])('rejects malformed fields %j', async (body) =>
    expect((await validate(plainToInstance(DemoQuickDto, body))).length).toBeGreaterThan(0),
  );
});
