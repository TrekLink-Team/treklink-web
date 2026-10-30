import type { PrismaService } from '../../common/prisma/prisma.service';
import type { AccountsService } from '../auth';
import type { MembersRepository } from './members.repository';
import type { OrganizationLifecycle } from './organization-lifecycle';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

// The live map's Field Station read (monitoring api-design 02, MF-02): stations not revoked, one
// organization's or the fleet's, with their last sync time.
describe('OrganizationsService.fieldStationHealth', () => {
  const ROW = {
    id: 'fs-1',
    organizationId: 'org-1',
    name: 'Ta Nang basecamp laptop',
    lastSyncAt: new Date('2026-10-30T03:00:00.000Z'),
  };
  let findMany: jest.Mock;
  let service: OrganizationsService;

  beforeEach(() => {
    findMany = jest.fn().mockResolvedValue([ROW]);
    const prisma = { fieldStation: { findMany } } as unknown as PrismaService;
    service = new OrganizationsService(
      new OrganizationsRepository(prisma),
      {} as MembersRepository,
      {} as AccountsService,
      {} as OrganizationLifecycle,
    );
  });

  it("lists one organization's stations that are not revoked, oldest first", async () => {
    await expect(service.fieldStationHealth('org-1')).resolves.toEqual([ROW]);
    expect(findMany).toHaveBeenCalledWith({
      where: { revokedAt: null, organizationId: 'org-1' },
      select: { id: true, organizationId: true, name: true, lastSyncAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('lists every organization for the fleet', async () => {
    await service.fieldStationHealth(null);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { revokedAt: null } }));
  });
});
