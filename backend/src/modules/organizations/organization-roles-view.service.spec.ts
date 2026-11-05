import { ErrorCode } from '../../common/errors';
import { OrganizationRolePolicyService } from '../auth';
import { OrganizationRolesViewService } from './organization-roles-view.service';
import { OrganizationsRepository } from './organizations.repository';

const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const VIEW = { roles: [], catalog: [] };

// api-design 33: the caller is already known to be TrekLink Staff or Admin (the controller policy),
// so the service only checks that the organization exists.
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

  it('gives the roles of any organization, whatever its status', async () => {
    organizations.findStatus.mockResolvedValue('SUSPENDED');
    await expect(service.view(ORG)).resolves.toBe(VIEW);
    expect(policies.viewOf).toHaveBeenCalledWith(ORG);
  });

  it('answers 404 for an organization that does not exist', async () => {
    organizations.findStatus.mockResolvedValue(null);
    await expect(service.view(ORG)).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
    expect(policies.viewOf).not.toHaveBeenCalled();
  });
});
