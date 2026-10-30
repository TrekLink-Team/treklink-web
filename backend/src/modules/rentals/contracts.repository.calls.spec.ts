import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ContractsRepository } from './contracts.repository';

// A Prisma stand-in that records every delegate call as [model.operation, args] and answers [].
const recorder = () => {
  const calls: [string, unknown][] = [];
  const client = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_inner, operation: string) => (args: unknown) => {
              calls.push([`${model}.${operation}`, args]);
              return Promise.resolve(operation === 'count' ? 0 : []);
            },
          },
        ),
    },
  );
  return { calls, client: client as unknown as PrismaService & Prisma.TransactionClient };
};

const AT = new Date('2026-10-29T03:00:00Z');

// The repository's simple reads and writes: each one's query shape, through the default client and
// through a caller's transaction.
describe('ContractsRepository delegate calls', () => {
  it('pages with every filter, or none, through the default client', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository(client);
    await repository.page(
      { organizationId: 'org-1', status: ContractStatus.ACTIVE, planType: PlanType.MONTHLY },
      10,
      5,
    );
    await repository.page({}, 0, 20, client);
    expect(calls.map(([name]) => name)).toEqual([
      'rentalContract.findMany',
      'rentalContract.count',
      'rentalContract.findMany',
      'rentalContract.count',
    ]);
    expect(calls[0][1]).toMatchObject({
      where: { organizationId: 'org-1', status: 'ACTIVE', planType: 'MONTHLY' },
      orderBy: [{ statusChangedAt: 'desc' }, { code: 'desc' }],
      skip: 10,
      take: 5,
    });
    expect(calls[2][1]).toMatchObject({ where: {} });
  });

  it('reads detail, transitions, live rows, the note, codes and term numbers', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository(client);
    await repository.detail('c-1');
    await repository.detail('c-1', client);
    await repository.transitionsOf('c-1');
    await repository.transitionsOf('c-1', client);
    await repository.liveRows('c-1');
    await repository.liveRows('c-1', client);
    await repository.noteOf('c-1');
    await repository.noteOf('c-1', client);
    await repository.codes(['c-1']);
    await repository.codes(['c-1'], client);
    await repository.termSeqs(['t-1']);
    await repository.termSeqs(['t-1'], client);
    expect(calls.map(([name, args]) => [name, (args as { where: unknown }).where])).toEqual([
      ['rentalContract.findUnique', { id: 'c-1' }],
      ['rentalContract.findUnique', { id: 'c-1' }],
      ['contractTransition.findMany', { contractId: 'c-1' }],
      ['contractTransition.findMany', { contractId: 'c-1' }],
      [
        'contractDevice.findMany',
        { contractId: 'c-1', releasedAt: null, replacedBy: { is: null } },
      ],
      [
        'contractDevice.findMany',
        { contractId: 'c-1', releasedAt: null, replacedBy: { is: null } },
      ],
      ['rentalContract.findUnique', { id: 'c-1' }],
      ['rentalContract.findUnique', { id: 'c-1' }],
      ['rentalContract.findMany', { id: { in: ['c-1'] } }],
      ['rentalContract.findMany', { id: { in: ['c-1'] } }],
      ['contractTerm.findMany', { id: { in: ['t-1'] } }],
      ['contractTerm.findMany', { id: { in: ['t-1'] } }],
    ]);
  });

  it('writes terms, decisions, cancellations, notices and the handover in the caller transaction', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository({} as PrismaService);
    const term = { contractId: 'c-1', seq: 1, startsAt: AT, endsAt: AT } as never;
    await repository.insertTerm(term, client);
    await repository.recordDecision('c-1', { approvedAt: AT } as never, client);
    await repository.recordCancellation('c-1', 'No longer needed', AT, client);
    await repository.recordNotice(
      'c-1',
      { noticeGivenAt: AT, noticeGivenById: 'u-1', endsAt: AT },
      client,
    );
    const handover = {
      handedOverAt: AT,
      handedOverById: 'u-1',
      identityChecked: 'CCCD',
      handoverNotePath: 'notes/c-1.pdf',
      handoverNoteSha256: 'ab',
    };
    await repository.recordHandover('c-1', handover, client);
    expect(calls).toEqual([
      ['contractTerm.create', expect.objectContaining({ data: term })],
      ['rentalContract.update', { where: { id: 'c-1' }, data: { approvedAt: AT } }],
      [
        'rentalContract.update',
        { where: { id: 'c-1' }, data: { cancelledAt: AT, cancelReason: 'No longer needed' } },
      ],
      [
        'rentalContract.update',
        { where: { id: 'c-1' }, data: { noticeGivenAt: AT, noticeGivenById: 'u-1', endsAt: AT } },
      ],
      ['rentalContract.update', { where: { id: 'c-1' }, data: handover }],
    ]);
  });

  it('releases reserved rows and returns their devices, and moves rows through custody', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository({} as PrismaService);
    await expect(repository.releaseReservedRows('c-1', AT, client)).resolves.toEqual([]);
    await repository.openTerm('c-1', client);
    await repository.findDeviceRow('c-1', 'd-1', client);
    await repository.releaseRow('row-1', AT, client);
    await repository.markRowsHandedOver('c-1', AT, client);
    expect(calls.map(([name, args]) => [name, args])).toEqual([
      [
        'contractDevice.findMany',
        expect.objectContaining({
          where: { contractId: 'c-1', releasedAt: null, handedOverAt: null },
        }),
      ],
      [
        'contractDevice.updateMany',
        {
          where: { contractId: 'c-1', releasedAt: null, handedOverAt: null },
          data: { releasedAt: AT },
        },
      ],
      [
        'contractTerm.findFirst',
        expect.objectContaining({ where: { contractId: 'c-1', status: 'OPEN' } }),
      ],
      [
        'contractDevice.findFirst',
        expect.objectContaining({
          where: { contractId: 'c-1', deviceId: 'd-1', releasedAt: null },
        }),
      ],
      ['contractDevice.update', { where: { id: 'row-1' }, data: { releasedAt: AT } }],
      [
        'contractDevice.updateMany',
        {
          where: { contractId: 'c-1', releasedAt: null, handedOverAt: null },
          data: { handedOverAt: AT },
        },
      ],
    ]);
  });

  it('reads the rental periods of a device and the intervals overlapping a range (rentals 4.5)', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository(client);
    const from = new Date('2026-10-01T00:00:00Z');
    await repository.rentalPeriodsOfDevice('dev-1', 'org-1');
    await repository.intervalsOverlapping(from, AT, client);
    expect(calls).toEqual([
      [
        'contractDevice.findMany',
        {
          where: {
            deviceId: 'dev-1',
            handedOverAt: { not: null },
            contract: { organizationId: 'org-1' },
          },
          orderBy: { handedOverAt: 'asc' },
          select: { contractId: true, handedOverAt: true, checkedInAt: true, lostAt: true },
        },
      ],
      [
        'contractDevice.findMany',
        {
          where: {
            handedOverAt: { lt: AT },
            AND: [
              { OR: [{ checkedInAt: null }, { checkedInAt: { gt: from } }] },
              { OR: [{ lostAt: null }, { lostAt: { gt: from } }] },
            ],
          },
          select: {
            handedOverAt: true,
            checkedInAt: true,
            lostAt: true,
            contract: { select: { hardwareVariantId: true } },
          },
        },
      ],
    ]);
  });

  it('sets a holder label, partial or full, and clears it', async () => {
    const { calls, client } = recorder();
    const repository = new ContractsRepository({} as PrismaService);
    await repository.setHolder('row-1', { name: 'Le Thi E' } as never, client);
    await repository.setHolder(
      'row-1',
      { name: 'Le Thi E', phone: '0912', emergencyContact: '0913' },
      client,
    );
    await repository.setHolder('row-1', null, client);
    expect(calls.map(([, args]) => (args as { data: unknown }).data)).toEqual([
      { holderName: 'Le Thi E', holderPhone: null, holderEmergencyContact: null },
      { holderName: 'Le Thi E', holderPhone: '0912', holderEmergencyContact: '0913' },
      { holderName: null, holderPhone: null, holderEmergencyContact: null },
    ]);
  });
});
