import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  AUTHENTICATED_ONLY_KEY,
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { DemoController, SwitchRoleDto } from './demo.controller';
import { DemoScenariosService } from './demo-scenarios.service';

const metadataOf = (key: string, method: keyof DemoController) =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(DemoController.prototype, method)!.value as object,
  ) as unknown;

describe('DemoController', () => {
  it.each([
    ['list', 'stage'],
    ['stage', 'stage'],
    ['switchRole', 'switchRole'],
  ] as const)('checks %s against %s on Demo', (method, action) => {
    const can = jest.fn().mockReturnValue(true);
    const ability: PolicyAbility = { can };
    const handlers = metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[];
    expect(handlers.length).toBeGreaterThan(0);
    expect(handlers.every((handler) => handler(ability))).toBe(true);
    expect(can).toHaveBeenCalledWith(action, 'Demo');
  });

  it('refuses a caller without the permission', () => {
    const ability: PolicyAbility = { can: () => false };
    for (const method of ['list', 'stage', 'switchRole'] as const) {
      const handlers = metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[];
      expect(handlers.every((handler) => handler(ability))).toBe(false);
    }
  });

  it('opens the status to any signed-in user, not to the public', () => {
    expect(metadataOf(AUTHENTICATED_ONLY_KEY, 'status')).toBe(true);
    expect(metadataOf(CHECK_POLICIES_KEY, 'status')).toBeUndefined();
  });

  it('names its envelope messages', () => {
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'stage')).toBe('Scenario staged');
    expect(metadataOf(RESPONSE_MESSAGE_KEY, 'switchRole')).toBe('Signed in');
  });

  it('passes the caller client to the service', async () => {
    const stage = jest.fn().mockResolvedValue('staged');
    const switchRole = jest.fn().mockResolvedValue('switched');
    const controller = new DemoController({ stage, switchRole } as unknown as DemoScenariosService);
    await expect(controller.stage('clean', '127.0.0.1', 'jest')).resolves.toBe('staged');
    expect(stage).toHaveBeenCalledWith('clean', { ip: '127.0.0.1', userAgent: 'jest' });
    await controller.switchRole({ role: 'STAFF' }, undefined, undefined);
    expect(switchRole).toHaveBeenCalledWith('STAFF', { ip: null, userAgent: null });
  });

  it('accepts only the four seeded roles', async () => {
    const errorsOf = async (body: object) =>
      (await validate(plainToInstance(SwitchRoleDto, body))).map((e) => e.property);
    expect(await errorsOf({ role: 'ORG_OPERATOR' })).toEqual([]);
    expect(await errorsOf({ role: 'ROOT' })).toEqual(['role']);
    expect(await errorsOf({})).toEqual(['role']);
  });
});
