import { Test } from '@nestjs/testing';
import { AlertChannel, Prisma } from '@prisma/client';
import { AlertDeliveriesRepository } from './alert-deliveries.repository';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { IncidentsModule } from './incidents.module';
import { IncidentsRepository } from './incidents.repository';

describe('incident persistence (task 1.1)', () => {
  it('registers the three private repositories without external module providers', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [IncidentsModule] }).compile();
    expect(moduleRef.get(IncidentsRepository)).toBeInstanceOf(IncidentsRepository);
    expect(moduleRef.get(AlertDeliveriesRepository)).toBeInstanceOf(AlertDeliveriesRepository);
    expect(moduleRef.get(AuthorityReportsRepository)).toBeInstanceOf(AuthorityReportsRepository);
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
    const repository = new AuthorityReportsRepository();
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
});
