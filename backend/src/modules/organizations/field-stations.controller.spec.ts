import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import {
  CHECK_POLICIES_KEY,
  Caller,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AppAbility } from '../auth/casl/ability.factory';
import { FieldStationsController } from './field-stations.controller';
import { FieldStationsService } from './field-stations.service';

const CALLER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const RESULT = { id: 'fs-1' };

const policyOf = (method: keyof FieldStationsController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(FieldStationsController.prototype)[method];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

const can = (action: string) =>
  createMongoAbility([{ action, subject: 'FieldStation' }]) as unknown as AppAbility;

describe('FieldStationsController (api-design 23 to 26)', () => {
  let service: {
    list: jest.Mock;
    currentRelease: jest.Mock;
    create: jest.Mock;
    revoke: jest.Mock;
  };
  let controller: FieldStationsController;

  beforeEach(() => {
    service = {
      list: jest.fn().mockResolvedValue({ items: [], limit: 5 }),
      currentRelease: jest.fn().mockResolvedValue({ version: '1.2.0' }),
      create: jest.fn().mockResolvedValue(RESULT),
      revoke: jest.fn().mockResolvedValue(RESULT),
    };
    controller = new FieldStationsController(service as unknown as FieldStationsService);
  });

  it('lets a reader list and read the release, a creator create, and a revoker revoke', () => {
    for (const method of ['list', 'release'] as const) {
      expect(policyOf(method)(can('read'))).toBe(true);
      expect(policyOf(method)(can('create'))).toBe(false);
    }
    expect(policyOf('create')(can('create'))).toBe(true);
    expect(policyOf('create')(can('read'))).toBe(false);
    expect(policyOf('create')(can('revoke'))).toBe(false);
    expect(policyOf('revoke')(can('revoke'))).toBe(true);
    expect(policyOf('revoke')(can('read'))).toBe(false);
    for (const method of ['create', 'revoke'] as const) {
      expect(policyOf(method)(can('manage'))).toBe(true);
    }
  });

  it('delegates the list, the release and the create to the service', async () => {
    await expect(controller.list('org-1', CALLER)).resolves.toEqual({ items: [], limit: 5 });
    expect(service.list).toHaveBeenCalledWith('org-1', CALLER);

    await expect(controller.release('org-1', CALLER)).resolves.toEqual({ version: '1.2.0' });
    expect(service.currentRelease).toHaveBeenCalledWith('org-1', CALLER);

    await expect(controller.create('org-1', { name: 'Ta Nang laptop' }, CALLER)).resolves.toBe(
      RESULT,
    );
    expect(service.create).toHaveBeenCalledWith('org-1', 'Ta Nang laptop', CALLER);
  });

  it('revokes with the reason, or without one when it is blank or absent', async () => {
    await controller.revoke('org-1', 'fs-1', { reason: 'Laptop stolen' }, CALLER);
    expect(service.revoke).toHaveBeenLastCalledWith('org-1', 'fs-1', 'Laptop stolen', CALLER);

    await controller.revoke('org-1', 'fs-1', { reason: '' }, CALLER);
    expect(service.revoke).toHaveBeenLastCalledWith('org-1', 'fs-1', undefined, CALLER);

    await controller.revoke('org-1', 'fs-1', {}, CALLER);
    expect(service.revoke).toHaveBeenLastCalledWith('org-1', 'fs-1', undefined, CALLER);
  });
});
