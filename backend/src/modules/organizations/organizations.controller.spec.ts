import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import {
  CHECK_POLICIES_KEY,
  Caller,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { AppAbility } from '../auth/casl/ability.factory';
import { UpdateOrganizationDto } from './dto/profile.dto';
import { OrganizationProfileService } from './organization-profile.service';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';

const ADMIN: Caller = { id: 'u-admin', roles: ['ADMIN'], organizationId: null };

const policyOf = (method: keyof OrganizationsController): PolicyHandler => {
  const descriptor = Object.getOwnPropertyDescriptors(OrganizationsController.prototype)[method];
  const [policy] = new Reflector().get<PolicyHandler[]>(
    CHECK_POLICIES_KEY,
    descriptor.value as (...args: never[]) => unknown,
  );
  return policy;
};

const can = (action: string, subject: string) =>
  createMongoAbility([{ action, subject }]) as unknown as AppAbility;

describe('OrganizationsController (api-design 03, 04, 12)', () => {
  let organizations: { membersOf: jest.Mock };
  let profile: { detail: jest.Mock; update: jest.Mock };
  let controller: OrganizationsController;

  beforeEach(() => {
    organizations = { membersOf: jest.fn().mockResolvedValue([]) };
    profile = {
      detail: jest.fn().mockResolvedValue({ id: 'org-1' }),
      update: jest.fn().mockResolvedValue({ id: 'org-1', version: 4 }),
    };
    controller = new OrganizationsController(
      organizations as unknown as OrganizationsService,
      profile as unknown as OrganizationProfileService,
    );
  });

  it('reads the detail through the profile service', async () => {
    await expect(controller.detail('org-1', ADMIN)).resolves.toEqual({ id: 'org-1' });
    expect(profile.detail).toHaveBeenCalledWith('org-1', ADMIN);
  });

  it('passes the edit and its body to the profile service', async () => {
    const body = Object.assign(new UpdateOrganizationDto(), {
      contactPhone: '0287654321',
      expectedVersion: 3,
    });
    await expect(controller.update('org-1', body, ADMIN)).resolves.toEqual({
      id: 'org-1',
      version: 4,
    });
    expect(profile.update).toHaveBeenCalledWith('org-1', body, ADMIN);
  });

  it('lists the members, deactivated ones only when asked', async () => {
    await controller.members('org-1', { includeDeactivated: true }, ADMIN);
    await controller.members('org-1', {}, ADMIN);
    expect(organizations.membersOf).toHaveBeenNthCalledWith(1, 'org-1', true, ADMIN);
    expect(organizations.membersOf).toHaveBeenNthCalledWith(2, 'org-1', false, ADMIN);
  });

  it('guards each route with its own policy', () => {
    expect(policyOf('detail')(can('read', 'Organization'))).toBe(true);
    expect(policyOf('detail')(can('update', 'Organization'))).toBe(false);
    expect(policyOf('update')(can('update', 'Organization'))).toBe(true);
    expect(policyOf('update')(can('read', 'Organization'))).toBe(false);
    expect(policyOf('members')(can('read', 'Member'))).toBe(true);
    expect(policyOf('members')(can('read', 'Organization'))).toBe(false);
  });
});
