import { SimulatedNodeStatus } from '@prisma/client';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SimulatedNodesRepository, STOPPED_LISTED } from './simulated-nodes.repository';

// gateway-sync, specs/demo/design.md section 9, demo api-design 06: the writer and reader of
// `simulated_nodes`. The simulation decisions are in field-simulation.service.spec.ts, which mocks this
// class; this file asserts the where clauses, the listing order and the two guarded updates.

const AT = new Date('2026-11-20T03:00:00.000Z');
const LATER = new Date('2026-11-20T03:00:30.000Z');
const node = (id: string, status: SimulatedNodeStatus = SimulatedNodeStatus.RUNNING) => ({
  id,
  status,
  version: 2,
});

const aClient = () => ({
  simulatedNode: {
    create: jest.fn().mockResolvedValue(node('n-1')),
    findUnique: jest.fn().mockResolvedValue(node('n-1')),
    findFirst: jest.fn().mockResolvedValue(node('n-1')),
    findMany: jest.fn().mockResolvedValue([]),
    updateMany: jest.fn().mockResolvedValue({ count: 1 }),
  },
});

describe('SimulatedNodesRepository', () => {
  let prisma: ReturnType<typeof aClient>;
  let tx: ReturnType<typeof aClient>;
  let repository: SimulatedNodesRepository;

  beforeEach(() => {
    prisma = aClient();
    tx = aClient();
    repository = new SimulatedNodesRepository(prisma as unknown as PrismaService);
  });

  it('insert and byId write and read through the given client', async () => {
    const data = { deviceId: 'd-1' } as never;
    await repository.insert(data);
    expect(prisma.simulatedNode.create).toHaveBeenCalledWith({ data });
    await repository.byId('n-1', tx as never);
    expect(tx.simulatedNode.findUnique).toHaveBeenCalledWith({ where: { id: 'n-1' } });
    expect(prisma.simulatedNode.findUnique).not.toHaveBeenCalled();
  });

  it('runningForDevice reads the running node of the device only', async () => {
    await repository.runningForDevice('d-1');
    expect(prisma.simulatedNode.findFirst).toHaveBeenCalledWith({
      where: { deviceId: 'd-1', status: SimulatedNodeStatus.RUNNING },
    });
  });

  it('running reads the running nodes, oldest first', async () => {
    await repository.running();
    expect(prisma.simulatedNode.findMany).toHaveBeenCalledWith({
      where: { status: SimulatedNodeStatus.RUNNING },
      orderBy: { createdAt: 'asc' },
    });
  });

  describe('listed (demo api-design 06)', () => {
    it('lists the running nodes first, then the most recently stopped ones, capped', async () => {
      prisma.simulatedNode.findMany
        .mockResolvedValueOnce([node('n-1'), node('n-2')])
        .mockResolvedValueOnce([node('n-9', SimulatedNodeStatus.STOPPED)]);
      await expect(repository.listed()).resolves.toEqual([
        node('n-1'),
        node('n-2'),
        node('n-9', SimulatedNodeStatus.STOPPED),
      ]);
      expect(prisma.simulatedNode.findMany).toHaveBeenNthCalledWith(2, {
        where: { status: SimulatedNodeStatus.STOPPED },
        orderBy: { updatedAt: 'desc' },
        take: STOPPED_LISTED,
      });
      expect(STOPPED_LISTED).toBe(20);
    });

    it('runs both reads on the transaction client when one is given', async () => {
      await repository.listed(tx as never);
      expect(tx.simulatedNode.findMany).toHaveBeenCalledTimes(2);
      expect(prisma.simulatedNode.findMany).not.toHaveBeenCalled();
    });
  });

  describe('updateRunning (D-034 rule 1)', () => {
    it('writes only a RUNNING node at the expected version, bumps it, and reads it back', async () => {
      tx.simulatedNode.findUnique.mockResolvedValue({ ...node('n-1'), version: 3 });
      await expect(
        repository.updateRunning('n-1', 2, { intervalSeconds: 30 } as never, tx as never),
      ).resolves.toEqual({ ...node('n-1'), version: 3 });
      expect(tx.simulatedNode.updateMany).toHaveBeenCalledWith({
        where: { id: 'n-1', version: 2, status: SimulatedNodeStatus.RUNNING },
        data: { intervalSeconds: 30, version: { increment: 1 } },
      });
      expect(tx.simulatedNode.findUnique).toHaveBeenCalledWith({ where: { id: 'n-1' } });
    });

    it('returns null and reads nothing when another write came first or the node stopped', async () => {
      prisma.simulatedNode.updateMany.mockResolvedValue({ count: 0 });
      await expect(repository.updateRunning('n-1', 2, {})).resolves.toBeNull();
      expect(prisma.simulatedNode.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('markBeaconed', () => {
    it('only moves the beacon mark forward, on the running node of that SOS, without a version bump', async () => {
      await expect(repository.markBeaconed('n-1', AT, LATER)).resolves.toBeUndefined();
      expect(prisma.simulatedNode.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'n-1',
          status: SimulatedNodeStatus.RUNNING,
          sosSince: AT,
          OR: [{ beaconedUntil: null }, { beaconedUntil: { lt: LATER } }],
        },
        data: { beaconedUntil: LATER },
      });
    });
  });
});
