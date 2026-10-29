import { Incident, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IncidentsRepository } from './incidents.repository';

const tx = (update: jest.Mock) => ({ incident: { update } }) as unknown as Prisma.TransactionClient;
const CURRENT = {
  id: 'inc-1',
  lastEventAt: new Date('2026-10-29T03:00:00Z'),
} as Pick<Incident, 'id' | 'lastEventAt'>;

describe('IncidentsRepository.appendEvent (design §4 steps 4 and 5)', () => {
  const repository = new IncidentsRepository({} as PrismaService);

  it('counts a later SOS, moves the last event and position, and confirms', async () => {
    const update = jest.fn().mockResolvedValue({});
    const occurredAt = new Date('2026-10-29T03:05:00Z');
    await repository.appendEvent(CURRENT, { occurredAt, latitude: 21, longitude: 105 }, tx(update));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        eventCount: { increment: 1 },
        confidence: 'CONFIRMED',
        lastEventAt: occurredAt,
        lastLatitude: 21,
        lastLongitude: 105,
      },
    });
  });

  it('counts a late SOS without moving the last event or position, and never the version', async () => {
    const update = jest.fn().mockResolvedValue({});
    await repository.appendEvent(
      CURRENT,
      { occurredAt: new Date('2026-10-29T02:00:00Z'), latitude: 1, longitude: 2 },
      tx(update),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { eventCount: { increment: 1 }, confidence: 'CONFIRMED' },
    });
  });

  it('keeps the position when a later SOS carried none', async () => {
    const update = jest.fn().mockResolvedValue({});
    const occurredAt = new Date('2026-10-29T03:05:00Z');
    await repository.appendEvent(CURRENT, { occurredAt }, tx(update));
    expect((update.mock.calls[0] as unknown[])[0]).toEqual({
      where: { id: 'inc-1' },
      data: { eventCount: { increment: 1 }, confidence: 'CONFIRMED', lastEventAt: occurredAt },
    });
  });
});

describe('IncidentsRepository reads (incidents 5.1)', () => {
  let prisma: {
    $transaction: jest.Mock;
    incident: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    incidentStatusUpdate: { findMany: jest.Mock };
    authorityReport: { findMany: jest.Mock };
    incidentTransition: { findFirst: jest.Mock };
  };
  let repository: IncidentsRepository;

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
      incident: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        findUnique: jest.fn().mockResolvedValue(null),
      },
      incidentStatusUpdate: { findMany: jest.fn().mockResolvedValue([]) },
      authorityReport: { findMany: jest.fn().mockResolvedValue([]) },
      incidentTransition: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    repository = new IncidentsRepository(prisma as unknown as PrismaService);
  });

  it('pages in the D-059 order, deadline ascending with nulls last, then newest episode', async () => {
    await expect(repository.page({ organizationId: 'org-a' }, 20, 10)).resolves.toEqual([[], 0]);
    expect(prisma.incident.findMany).toHaveBeenCalledWith({
      where: { organizationId: 'org-a' },
      orderBy: [{ tierDeadlineAt: { sort: 'asc', nulls: 'last' } }, { firstEventAt: 'desc' }],
      skip: 20,
      take: 10,
    });
    expect(prisma.incident.count).toHaveBeenCalledWith({ where: { organizationId: 'org-a' } });
  });

  it('reads one incident, its status updates and its reports newest first', async () => {
    await repository.findById('inc-1');
    expect(prisma.incident.findUnique).toHaveBeenCalledWith({ where: { id: 'inc-1' } });
    await repository.statusUpdates('inc-1');
    expect(prisma.incidentStatusUpdate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentId: 'inc-1' }, orderBy: { createdAt: 'desc' } }),
    );
    await repository.authorityReports('inc-1');
    expect(prisma.authorityReport.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentId: 'inc-1' }, orderBy: { reportedAt: 'desc' } }),
    );
  });

  it('reads the latest ACKNOWLEDGED transition for MSG27', async () => {
    await repository.latestAcknowledgement('inc-1');
    expect(prisma.incidentTransition.findFirst).toHaveBeenCalledWith({
      where: { incidentId: 'inc-1', toState: 'ACKNOWLEDGED' },
      orderBy: { seq: 'desc' },
      select: { actorId: true, createdAt: true },
    });
  });
});
