import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IngestionRepository } from './ingestion.repository';

describe('IngestionRepository.linkIncident (MF-03 SOS hand-off)', () => {
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
