import { ConfigService } from '@nestjs/config';
import { AlertStatus } from '@prisma/client';
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

// `alertDeliveryStats()` for the system health read (monitoring api-design 06).
describe('IncidentsQueryService.alertDeliveryStats', () => {
  const build = (repository: Partial<IncidentsRepository>) =>
    new IncidentsQueryService(
      repository as IncidentsRepository,
      {} as DevicesService,
      {} as ContractsService,
      {} as OrganizationsService,
      {} as ConfigService<ValidatedEnvironment, true>,
    );

  it('counts the rows waiting and the rows whose retries ran out, and leaves SENT out', async () => {
    const alertDeliveryCounts = jest.fn().mockResolvedValue(
      new Map([
        [AlertStatus.PENDING, 2],
        [AlertStatus.SENT, 40],
        [AlertStatus.FAILED, 1],
      ]),
    );
    await expect(build({ alertDeliveryCounts }).alertDeliveryStats()).resolves.toEqual({
      pending: 2,
      failed: 1,
    });
  });

  it('answers zero for a status with no rows', async () => {
    const alertDeliveryCounts = jest.fn().mockResolvedValue(new Map());
    await expect(build({ alertDeliveryCounts }).alertDeliveryStats()).resolves.toEqual({
      pending: 0,
      failed: 0,
    });
  });

  it('groups the outbox by status in the repository', async () => {
    const groupBy = jest.fn().mockResolvedValue([
      { status: AlertStatus.PENDING, _count: { _all: 5 } },
      { status: AlertStatus.FAILED, _count: { _all: 1 } },
    ]);
    const counts = await new IncidentsRepository({
      alertDelivery: { groupBy },
    } as unknown as PrismaService).alertDeliveryCounts();
    expect(groupBy).toHaveBeenCalledWith({ by: ['status'], _count: { _all: true } });
    expect([...counts.entries()]).toEqual([
      [AlertStatus.PENDING, 5],
      [AlertStatus.FAILED, 1],
    ]);
  });
});
