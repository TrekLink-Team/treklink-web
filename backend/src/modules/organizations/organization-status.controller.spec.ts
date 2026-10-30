import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import {
  CHECK_POLICIES_KEY,
  Caller,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AppAbility } from '../auth/casl/ability.factory';
import { OrganizationStatusController } from './organization-status.controller';
import { OrganizationStatusService } from './organization-status.service';

const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };
const RESULT = { id: 'org-1' };

const policyOf = (method: keyof OrganizationStatusController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(OrganizationStatusController.prototype)[
    method
  ];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

const can = (action: string) =>
  createMongoAbility([{ action, subject: 'Organization' }]) as unknown as AppAbility;

describe('OrganizationStatusController (api-design 08 to 11)', () => {
  let service: {
    suspend: jest.Mock;
    reactivate: jest.Mock;
    close: jest.Mock;
    transitions: jest.Mock;
  };
  let controller: OrganizationStatusController;

  beforeEach(() => {
    service = {
      suspend: jest.fn().mockResolvedValue(RESULT),
      reactivate: jest.fn().mockResolvedValue(RESULT),
      close: jest.fn().mockResolvedValue(RESULT),
      transitions: jest.fn().mockResolvedValue([]),
    };
    controller = new OrganizationStatusController(service as unknown as OrganizationStatusService);
  });

  it('lets only a holder of suspend suspend and reactivate, decide close, and read read the history', () => {
    for (const method of ['suspend', 'reactivate'] as const) {
      expect(policyOf(method)(can('suspend'))).toBe(true);
      expect(policyOf(method)(can('decide'))).toBe(false);
      expect(policyOf(method)(can('read'))).toBe(false);
    }
    expect(policyOf('close')(can('decide'))).toBe(true);
    expect(policyOf('close')(can('suspend'))).toBe(false);
    expect(policyOf('transitions')(can('read'))).toBe(true);
    expect(policyOf('transitions')(can('suspend'))).toBe(false);
  });

  it('delegates each call with the body and the caller', async () => {
    await expect(
      controller.suspend('org-1', { reason: 'Unpaid balance', expectedVersion: 3 }, ADMIN),
    ).resolves.toBe(RESULT);
    expect(service.suspend).toHaveBeenCalledWith('org-1', 'Unpaid balance', 3, ADMIN);

    await expect(controller.reactivate('org-1', { expectedVersion: 4 }, ADMIN)).resolves.toBe(
      RESULT,
    );
    expect(service.reactivate).toHaveBeenCalledWith('org-1', 4, ADMIN);

    await expect(
      controller.close('org-1', { reason: 'Customer request', expectedVersion: 3 }, ADMIN),
    ).resolves.toBe(RESULT);
    expect(service.close).toHaveBeenCalledWith('org-1', 'Customer request', 3, ADMIN);

    await expect(controller.transitions('org-1', ADMIN)).resolves.toEqual([]);
    expect(service.transitions).toHaveBeenCalledWith('org-1', ADMIN);
  });
});
