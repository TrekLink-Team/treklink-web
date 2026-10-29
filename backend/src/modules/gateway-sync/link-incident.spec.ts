import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IngestionRepository } from './ingestion.repository';

describe('IngestionRepository.linkIncident (MF-03 SOS and position hand-off)', () => {
  it('sets only the incident link of the stored event, in the ingestion transaction', async () => {
    const update = jest.fn().mockResolvedValue({});
    const tx = { fieldEvent: { update } } as unknown as Prisma.TransactionClient;
    await new IngestionRepository({} as PrismaService).linkIncident('evt-1', 'inc-1', tx);
    expect(update).toHaveBeenCalledWith({
      where: { eventId: 'evt-1' },
      data: { incidentId: 'inc-1' },
    });
  });
});

describe('IngestionRepository writes and the last plotted position', () => {
  const fake = (findFirst: unknown = null, count = 1) => ({
    fieldEvent: {
      createMany: jest.fn().mockResolvedValue({ count }),
      findFirst: jest.fn().mockResolvedValue(findFirst),
    },
    syncAuditLog: { create: jest.fn().mockResolvedValue({}) },
  });

  it('inserts an event once, through the default client or the caller transaction', async () => {
    const prisma = fake();
    const repository = new IngestionRepository(prisma as unknown as PrismaService);
    const data = { eventId: 'e-1' } as Prisma.FieldEventUncheckedCreateInput;
    await expect(repository.insertEventOnce(data)).resolves.toBe(true);
    const tx = fake(null, 0);
    await expect(
      repository.insertEventOnce(data, tx as unknown as Prisma.TransactionClient),
    ).resolves.toBe(false);
    expect(prisma.fieldEvent.createMany).toHaveBeenCalledWith({
      data: [data],
      skipDuplicates: true,
    });
  });

  it('writes an audit row through the default client or the caller transaction', async () => {
    const prisma = fake();
    const repository = new IngestionRepository(prisma as unknown as PrismaService);
    const row = { outcome: 'ACCEPTED' } as Prisma.SyncAuditLogUncheckedCreateInput;
    await repository.insertAudit(row);
    const tx = fake();
    await repository.insertAudit(row, tx as unknown as Prisma.TransactionClient);
    expect(prisma.syncAuditLog.create).toHaveBeenCalledWith({ data: row });
    expect(tx.syncAuditLog.create).toHaveBeenCalledWith({ data: row });
  });

  it('answers the last plotted position, or null when there is none', async () => {
    const at = new Date('2026-10-29T03:00:00Z');
    const prisma = fake({ latitude: 11.5, longitude: 108.5, occurredAt: at });
    const repository = new IngestionRepository(prisma as unknown as PrismaService);
    await expect(repository.lastPlottedPosition('d-1')).resolves.toEqual({
      latitude: 11.5,
      longitude: 108.5,
      occurredAt: at,
    });
    await expect(
      repository.lastPlottedPosition('d-1', fake() as unknown as Prisma.TransactionClient),
    ).resolves.toBeNull();
    await expect(
      repository.lastPlottedPosition(
        'd-1',
        fake({
          latitude: null,
          longitude: 1,
          occurredAt: at,
        }) as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toBeNull();
    await expect(
      repository.lastPlottedPosition(
        'd-1',
        fake({
          latitude: 1,
          longitude: null,
          occurredAt: at,
        }) as unknown as Prisma.TransactionClient,
      ),
    ).resolves.toBeNull();
  });
});
