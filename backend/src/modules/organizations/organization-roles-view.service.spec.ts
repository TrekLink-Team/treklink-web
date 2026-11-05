import { AbilityBuilder, createMongoAbility } from '@casl/ability';
import { type PolicyAbility } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { OrganizationRolePolicyService } from '../auth';
import { OrganizationRolesViewService } from './organization-roles-view.service';
import { OrganizationsRepository } from './organizations.repository';

const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const OTHER = '9a8b7c6d-1111-4222-8333-444455556666';
const VIEW = { roles: [], catalog: [] };

// The ability of a TrekLink account (`organizationRole.read`, no condition) and of a Manager
// (`organizationRole.manage.own`, its own organization).
const ability = (build: (rules: AbilityBuilder<ReturnType<typeof createMongoAbility>>) => void) => {
  const rules = new AbilityBuilder(createMongoAbility);
  build(rules);
  return rules.build() as unknown as PolicyAbility;
};
const staff = ability(({ can }) => can('read', 'OrganizationRole'));
const manager = ability(({ can }) => can('manage', 'OrganizationRole', { organizationId: ORG }));
const operator = ability(() => undefined);

// api-design 33: TrekLink Staff and Admin read any organization, a Manager its own, and another
// organization reads as unknown.
describe('OrganizationRolesViewService', () => {
  let organizations: { findStatus: jest.Mock };
  let policies: { viewOf: jest.Mock };
  let service: OrganizationRolesViewService;

  beforeEach(() => {
    organizations = { findStatus: jest.fn().mockResolvedValue('ACTIVE') };
    policies = { viewOf: jest.fn().mockResolvedValue(VIEW) };
    service = new OrganizationRolesViewService(
      organizations as unknown as OrganizationsRepository,
      policies as unknown as OrganizationRolePolicyService,
    );
  });

  it('gives TrekLink the roles of any organization, whatever its status', async () => {
    organizations.findStatus.mockResolvedValue('SUSPENDED');
    await expect(service.view(OTHER, staff)).resolves.toBe(VIEW);
    expect(policies.viewOf).toHaveBeenCalledWith(OTHER);
  });

  it('gives a Manager the roles of its own organization', async () => {
    await expect(service.view(ORG, manager)).resolves.toBe(VIEW);
    expect(policies.viewOf).toHaveBeenCalledWith(ORG);
  });

  it('answers 404 to a Manager for another organization and reads nothing', async () => {
    await expect(service.view(OTHER, manager)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    expect(organizations.findStatus).not.toHaveBeenCalled();
    expect(policies.viewOf).not.toHaveBeenCalled();
  });

  it('answers 404 for an organization that does not exist', async () => {
    organizations.findStatus.mockResolvedValue(null);
    await expect(service.view(OTHER, staff)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    expect(policies.viewOf).not.toHaveBeenCalled();
  });

  it('answers 404 to an account with no permission on the roles', async () => {
    await expect(service.view(ORG, operator)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});
