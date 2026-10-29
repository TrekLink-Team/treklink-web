import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { AlertChannel, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DevicesModule, DevicesService } from '../devices';
import { OrganizationsModule, OrganizationsService, RosterService } from '../organizations';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { PlatformModule } from '../platform/platform.module';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentsModule } from './incidents.module';
import { IncidentsRepository } from './incidents.repository';
import { IncidentLifecycle } from './incident-lifecycle';
import { ContractsService, RentalsModule } from '../rentals';
import { IncidentIngress } from './incident-ingress';
import { IncidentTimersJob } from './jobs/incident-timers.job';

@Module({
  providers: [
    { provide: TransactionalEvents, useValue: {} },
    { provide: ParameterService, useValue: {} },
    { provide: PrismaService, useValue: {} },
    { provide: EventEmitter2, useValue: {} },
    // Global in the application (ConfigModule.forRoot); stood in here.
    { provide: ConfigService, useValue: {} },
  ],
  exports: [TransactionalEvents, ParameterService, PrismaService, EventEmitter2, ConfigService],
})
// Global like PrismaModule in the application, so IncidentsPortsModule resolves PrismaService too.
@Global()
class TestPlatformModule {}

// The exported services of the modules incidents imports (platform design Figure 3).
@Module({
  providers: [
    { provide: OrganizationsService, useValue: {} },
    { provide: RosterService, useValue: {} },
  ],
  exports: [OrganizationsService, RosterService],
})
class TestOrganizationsModule {}

@Module({
  providers: [{ provide: ContractsService, useValue: {} }],
  exports: [ContractsService],
})
class TestRentalsModule {}

@Module({
  providers: [{ provide: DevicesService, useValue: {} }],
  exports: [DevicesService],
})
class TestDevicesModule {}

describe('incident persistence (task 1.1)', () => {
  it('registers the private repositories, lifecycle and ingress over its Figure 3 dependencies', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IncidentsModule] })
      .overrideModule(PlatformModule)
      .useModule(TestPlatformModule)
      .overrideModule(OrganizationsModule)
      .useModule(TestOrganizationsModule)
      .overrideModule(RentalsModule)
      .useModule(TestRentalsModule)
      .overrideModule(DevicesModule)
      .useModule(TestDevicesModule)
      .compile();
    expect(moduleRef.get(IncidentIngress)).toBeInstanceOf(IncidentIngress);
    expect(moduleRef.get(IncidentsRepository)).toBeInstanceOf(IncidentsRepository);
    expect(moduleRef.get(AlertDeliveriesRepository)).toBeInstanceOf(AlertDeliveriesRepository);
    expect(moduleRef.get(AuthorityReportsRepository)).toBeInstanceOf(AuthorityReportsRepository);
    expect(moduleRef.get(IncidentLifecycle)).toBeInstanceOf(IncidentLifecycle);
    expect(moduleRef.get(IncidentTimersJob)).toBeInstanceOf(IncidentTimersJob);
    await moduleRef.close();
  });

  it('enqueues alerts in the caller transaction without skipping duplicate failures', async () => {
    const createMany = jest.fn().mockResolvedValue({ count: 1 });
    const tx = { alertDelivery: { createMany } } as unknown as Prisma.TransactionClient;
    const repository = new AlertDeliveriesRepository();
    await repository.enqueue([], tx);
    expect(createMany).not.toHaveBeenCalled();
    const rows = [
      {
        incidentId: 'incident-1',
        transitionId: 'transition-1',
        tier: 'PRIMARY',
        recipientId: 'member-1',
        channel: AlertChannel.WEBSOCKET,
      },
    ];
    await repository.enqueue(rows, tx);
    expect(createMany).toHaveBeenCalledWith({ data: rows });
    const error = new Error('outbox failed');
    createMany.mockRejectedValue(error);
    await expect(repository.enqueue(rows, tx)).rejects.toBe(error);
  });

  it('writes either report subject through the caller transaction and propagates failures', async () => {
    const create = jest.fn().mockResolvedValue({ id: 'report-1' });
    const tx = { authorityReport: { create } } as unknown as Prisma.TransactionClient;
    const repository = new AuthorityReportsRepository({} as PrismaService);
    const fields = {
      agency: 'Test authority',
      reference: 'TEST-001',
      reportedAt: new Date('2026-10-23T09:00:00Z'),
      reportedById: 'staff-1',
    };
    await expect(repository.insert({ ...fields, incidentId: 'incident-1' }, tx)).resolves.toEqual({
      id: 'report-1',
    });
    await repository.insert({ ...fields, contractId: 'contract-1' }, tx);
    expect(create).toHaveBeenLastCalledWith({ data: { ...fields, contractId: 'contract-1' } });
    const error = new Error('foreign key failed');
    create.mockRejectedValue(error);
    await expect(repository.insert({ ...fields, incidentId: 'missing' }, tx)).rejects.toBe(error);
  });

  it('locks, closes and pages authority reports (api-design 09 and 11)', async () => {
    const row = { id: 'report-1' };
    const queryRaw = jest.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
    const update = jest.fn().mockResolvedValue(row);
    const tx = {
      $queryRaw: queryRaw,
      authorityReport: { update },
    } as unknown as Prisma.TransactionClient;
    const findMany = jest.fn().mockResolvedValue([row]);
    const count = jest.fn().mockResolvedValue(7);
    const repository = new AuthorityReportsRepository({
      authorityReport: { findMany, count },
    } as unknown as PrismaService);

    await expect(repository.lockById('report-1', tx)).resolves.toBe(row);
    await expect(repository.lockById('missing', tx)).resolves.toBeNull();
    const [sql] = queryRaw.mock.calls[0] as [TemplateStringsArray];
    expect(sql.join('?')).toContain('FOR UPDATE');

    const closedAt = new Date('2026-10-21T08:00:00Z');
    await repository.closeCase('report-1', closedAt, 'staff-1', tx);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'report-1' },
      data: { caseClosedAt: closedAt, caseClosedById: 'staff-1' },
    });

    const where = { caseClosedAt: null };
    await expect(repository.page(where, 20, 10)).resolves.toEqual([[row], 7]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where,
        orderBy: [{ reportedAt: 'desc' }, { id: 'desc' }],
        skip: 20,
        take: 10,
      }),
    );
    expect(count).toHaveBeenCalledWith({ where });
  });
});
