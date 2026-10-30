import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { ContractsService } from '../rentals';
import { IncidentsQueryService } from './incidents-query.service';
import { IncidentsRepository } from './incidents.repository';

// `openByDevices(ids)` for monitoring (incidents design §5, monitoring api-design 02 and 04).
describe('IncidentsQueryService.openByDevices', () => {
  const build = (repository: Partial<IncidentsRepository>) =>
    new IncidentsQueryService(
      repository as IncidentsRepository,
      {} as DevicesService,
      {} as ContractsService,
      {} as OrganizationsService,
      {} as ConfigService<ValidatedEnvironment, true>,
    );

  it('keys the newest open incident by device and keeps its routed organization', async () => {
    const openOfDevices = jest.fn().mockResolvedValue([
      {
        id: 'i-2',
        code: 'INC-2',
        state: 'NOTIFY_PRIMARY',
        deviceId: 'd-1',
        organizationId: 'org-1',
      },
      { id: 'i-1', code: 'INC-1', state: 'ACKNOWLEDGED', deviceId: 'd-1', organizationId: 'org-1' },
      { id: 'i-3', code: 'INC-3', state: 'UNROUTED', deviceId: 'd-2', organizationId: null },
    ]);
    const open = await build({ openOfDevices }).openByDevices(['d-1', 'd-2']);
    expect(openOfDevices).toHaveBeenCalledWith(['d-1', 'd-2']);
    expect([...open.entries()]).toEqual([
      ['d-1', { id: 'i-2', code: 'INC-2', state: 'NOTIFY_PRIMARY', organizationId: 'org-1' }],
      ['d-2', { id: 'i-3', code: 'INC-3', state: 'UNROUTED', organizationId: null }],
    ]);
  });

  it('reads nothing for no devices', async () => {
    const openOfDevices = jest.fn();
    await expect(build({ openOfDevices }).openByDevices([])).resolves.toEqual(new Map());
    expect(openOfDevices).not.toHaveBeenCalled();
  });

  it('asks the repository for incidents not yet CLOSED on the devices', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    await new IncidentsRepository({
      incident: { findMany },
    } as unknown as PrismaService).openOfDevices(['d-1']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { deviceId: { in: ['d-1'] }, state: { not: 'CLOSED' } } }),
    );
  });
});
