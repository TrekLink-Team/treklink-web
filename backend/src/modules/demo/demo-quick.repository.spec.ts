import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DemoQuickRepository } from './demo-quick.repository';

// The demo panel's quick runs and its escalation profile. The profile decisions are in
// demo-quick-profile.service.spec.ts; this file asserts the run rows, the single `escalation`
// control row, the lock taken on it and the compare-and-set on its version.

const state = (extra: Record<string, unknown> = {}) => ({
  id: 'escalation',
  snapshot: null,
  version: 4,
  ...extra,
});

describe('DemoQuickRepository', () => {
  let prisma: { demoScenarioRun: { create: jest.Mock } };
  let tx: {
    $queryRaw: jest.Mock;
    demoScenarioRun: { update: jest.Mock };
    demoControlState: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
    };
  };
  let repository: DemoQuickRepository;

  beforeEach(() => {
    prisma = { demoScenarioRun: { create: jest.fn().mockResolvedValue({ id: 7 }) } };
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
      demoScenarioRun: { update: jest.fn().mockResolvedValue({ id: 7 }) },
      demoControlState: {
        findUnique: jest.fn().mockResolvedValue(state()),
        upsert: jest.fn().mockResolvedValue(state()),
        findUniqueOrThrow: jest.fn().mockResolvedValue(state()),
        update: jest.fn().mockResolvedValue(state({ version: 5 })),
      },
    };
    repository = new DemoQuickRepository(prisma as unknown as PrismaService);
  });

  it('createRun records who started which action', async () => {
    await expect(repository.createRun('staff-1', 'sos')).resolves.toEqual({ id: 7 });
    expect(prisma.demoScenarioRun.create).toHaveBeenCalledWith({
      data: { actorId: 'staff-1', action: 'sos' },
    });
  });

  it.each([
    ['records and no error', { incidentId: 'i-1' }, null],
    ['the error of a failed run', [], 'Gateway did not answer.'],
  ])('saveRun keeps %s through the transaction', async (_label, records, error) => {
    await repository.saveRun(7, records, error, tx as never);
    expect(tx.demoScenarioRun.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { records, error },
    });
  });

  it('profile reads the escalation row, which may not exist yet', async () => {
    tx.demoControlState.findUnique.mockResolvedValue(null);
    await expect(repository.profile(tx as never)).resolves.toBeNull();
    expect(tx.demoControlState.findUnique).toHaveBeenCalledWith({ where: { id: 'escalation' } });
  });

  describe('lockProfile', () => {
    it('creates the row if missing, locks it, then reads it, in that order', async () => {
      await expect(repository.lockProfile(tx as never)).resolves.toEqual(state());
      expect(tx.demoControlState.upsert).toHaveBeenCalledWith({
        where: { id: 'escalation' },
        create: { id: 'escalation' },
        update: {},
      });
      const [strings] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray];
      expect(strings.join('?')).toBe(
        `SELECT 1 FROM "demo_control_states" WHERE "id" = 'escalation' FOR UPDATE`,
      );
      expect(tx.demoControlState.findUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'escalation' },
      });
      const order = [
        tx.demoControlState.upsert,
        tx.$queryRaw,
        tx.demoControlState.findUniqueOrThrow,
      ].map((mock) => mock.mock.invocationCallOrder[0]);
      expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('lets a failed lock reach the caller without reading the row', async () => {
      const error = new Error('lock timeout');
      tx.$queryRaw.mockRejectedValue(error);
      await expect(repository.lockProfile(tx as never)).rejects.toBe(error);
      expect(tx.demoControlState.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  });

  describe('saveProfile', () => {
    it('writes the snapshot only on the expected version and bumps it', async () => {
      const snapshot = { escalationSeconds: 30 };
      await repository.saveProfile(4, snapshot, tx as never);
      expect(tx.demoControlState.update).toHaveBeenCalledWith({
        where: { id: 'escalation', version: 4 },
        data: { snapshot, version: { increment: 1 } },
      });
    });

    it('stores a database NULL, not a JSON null, when the snapshot is cleared', async () => {
      await repository.saveProfile(4, null, tx as never);
      const [{ data }] = tx.demoControlState.update.mock.calls[0] as [
        { data: { snapshot: unknown } },
      ];
      expect(data.snapshot).toBe(Prisma.DbNull);
    });
  });
});
