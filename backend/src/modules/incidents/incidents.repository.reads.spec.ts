import { Incident, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { IncidentsRepository } from './incidents.repository';

const tx = (update: jest.Mock) => ({ incident: { update } }) as unknown as Prisma.TransactionClient;
const CURRENT = {
  id: 'inc-1',
  lastEventAt: new Date('2026-10-29T03:00:00Z'),
  lastPositionAt: null,
} as Pick<Incident, 'id' | 'lastEventAt' | 'lastPositionAt'>;

describe('IncidentsRepository.appendEvent (design §4 steps 4 and 5)', () => {
  const repository = new IncidentsRepository({} as PrismaService);

  it('counts a later SOS, moves the last SOS time and confirms', async () => {
    const update = jest.fn().mockResolvedValue({});
    const occurredAt = new Date('2026-10-29T03:05:00Z');
    await repository.appendEvent(CURRENT, occurredAt, tx(update));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { eventCount: { increment: 1 }, confidence: 'CONFIRMED', lastEventAt: occurredAt },
    });
  });

  it('counts a late SOS without moving the last SOS time, and never the version', async () => {
    const update = jest.fn().mockResolvedValue({});
    await repository.appendEvent(CURRENT, new Date('2026-10-29T02:00:00Z'), tx(update));
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: { eventCount: { increment: 1 }, confidence: 'CONFIRMED' },
    });
  });
});

describe('IncidentsRepository.movePosition (onPosition)', () => {
  const repository = new IncidentsRepository({} as PrismaService);
  const fix = (occurredAt: string) => ({
    occurredAt: new Date(occurredAt),
    latitude: 11.5,
    longitude: 108.5,
  });

  it('sets the first known position and its fix time', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'inc-1' });
    await expect(
      repository.movePosition(CURRENT, fix('2026-10-29T02:59:00Z'), tx(update)),
    ).resolves.toEqual({ id: 'inc-1' });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'inc-1' },
      data: {
        lastLatitude: 11.5,
        lastLongitude: 108.5,
        lastPositionAt: new Date('2026-10-29T02:59:00Z'),
      },
    });
  });

  it('moves a known position for a fix not older than the stored fix', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'inc-1' });
    await repository.movePosition(
      { ...CURRENT, lastPositionAt: new Date('2026-10-29T03:00:00Z') },
      fix('2026-10-29T03:00:00Z'),
      tx(update),
    );
    expect(update).toHaveBeenCalled();
  });

  it('keeps a known position against an out-of-order older fix, even one newer than the last SOS', async () => {
    const update = jest.fn();
    await expect(
      repository.movePosition(
        { ...CURRENT, lastPositionAt: new Date('2026-10-29T03:10:00Z') },
        fix('2026-10-29T03:05:00Z'),
        tx(update),
      ),
    ).resolves.toBeNull();
    expect(update).not.toHaveBeenCalled();
  });
});

describe('IncidentsRepository reads (incidents 5.1)', () => {
  let prisma: {
    $transaction: jest.Mock;
    incident: { findMany: jest.Mock; count: jest.Mock; findUnique: jest.Mock };
    incidentStatusUpdate: { findMany: jest.Mock };
    authorityReport: { findMany: jest.Mock };
    incidentTransition: { findFirst: jest.Mock; findMany: jest.Mock };
    alertDelivery: { findMany: jest.Mock };
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
      incidentTransition: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
      },
      alertDelivery: { findMany: jest.fn().mockResolvedValue([]) },
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

  it('reads the transition trail in sequence order (api-design 12)', async () => {
    await repository.transitions('inc-1');
    expect(prisma.incidentTransition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { incidentId: 'inc-1' }, orderBy: { seq: 'asc' } }),
    );
  });

  it('reads the alert deliveries oldest first (api-design 14)', async () => {
    await repository.alertDeliveries('inc-1');
    expect(prisma.alertDelivery.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { incidentId: 'inc-1' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
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

  it('reads the ACKNOWLEDGED and RESPONDING incidents an account owns (REQ-EVT-11)', async () => {
    await repository.ownedActive('u-1');
    expect(prisma.incident.findMany).toHaveBeenCalledWith({
      where: { ownerId: 'u-1', state: { in: ['ACKNOWLEDGED', 'RESPONDING'] } },
      orderBy: { firstEventAt: 'asc' },
      select: { id: true, state: true, organizationId: true, contractId: true },
    });
  });
});

describe('IncidentsRepository.dueTimers (task 3.1)', () => {
  it('reads the states whose deadline has passed, oldest deadline first, over the index', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'inc-1' }]);
    const repository = new IncidentsRepository({
      incident: { findMany },
    } as unknown as PrismaService);
    const now = new Date('2026-10-30T03:00:00Z');
    await expect(
      repository.dueTimers(['ACKNOWLEDGED', 'RESPONDING'], 'statusDueAt', now, 100),
    ).resolves.toEqual([{ id: 'inc-1' }]);
    expect(findMany).toHaveBeenCalledWith({
      where: { state: { in: ['ACKNOWLEDGED', 'RESPONDING'] }, statusDueAt: { lte: now } },
      orderBy: { statusDueAt: 'asc' },
      take: 100,
      select: { id: true, state: true, organizationId: true },
    });
  });
});
