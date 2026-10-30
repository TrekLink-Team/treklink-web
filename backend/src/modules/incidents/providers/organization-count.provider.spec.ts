import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { OrganizationCountProvider } from '../../organizations';
import { IncidentsRepository } from '../incidents.repository';
import { IncidentsOrganizationCount } from './organization-count.provider';

describe('IncidentsOrganizationCount (organizations port ORGANIZATION_COUNTS)', () => {
  it('adds itself to the array of the port, and registers nowhere without the port', () => {
    const counts: OrganizationCountProvider[] = [];
    const provider = new IncidentsOrganizationCount({} as IncidentsRepository, counts);
    expect(counts).toEqual([provider]);
    expect(provider.name).toBe('openIncidents');

    expect(() => new IncidentsOrganizationCount({} as IncidentsRepository)).not.toThrow();
  });

  it('counts through the repository', async () => {
    const incidents = { countOpenOfOrganization: jest.fn().mockResolvedValue(2) };
    const provider = new IncidentsOrganizationCount(incidents as unknown as IncidentsRepository);
    await expect(provider.count('org-1')).resolves.toBe(2);
    expect(incidents.countOpenOfOrganization).toHaveBeenCalledWith('org-1');
  });

  it('counts the incidents of an organization that are not CLOSED', async () => {
    const count = jest.fn().mockResolvedValue(1);
    const client = { incident: { count } } as unknown as Prisma.TransactionClient;
    const repository = new IncidentsRepository({ incident: { count } } as unknown as PrismaService);

    await expect(repository.countOpenOfOrganization('org-1')).resolves.toBe(1);
    await repository.countOpenOfOrganization('org-1', client);

    expect(count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', state: { not: 'CLOSED' } },
    });
    expect(count).toHaveBeenCalledTimes(2);
  });
});
