import { Incident, IncidentConfidence, IncidentSource, Prisma } from '@prisma/client';
import { IncidentsRepository, NewIncident } from './incidents.repository';

const NOW = new Date('2026-10-23T09:00:00.000Z');
const INPUT: NewIncident = {
  deviceId: 'device-1',
  source: IncidentSource.DEVICE_SOS,
  confidence: IncidentConfidence.CONFIRMED,
  firstEventAt: NOW,
  lastEventAt: NOW,
};
const ROW = { id: 'incident-1', deviceId: INPUT.deviceId } as Incident;
const uniqueError = (target?: unknown, code = 'P2002') =>
  new Prisma.PrismaClientKnownRequestError('constraint failed', {
    code,
    clientVersion: '6',
    ...(target === undefined ? {} : { meta: { target } }),
  });

describe('IncidentsRepository (task 1.1)', () => {
  let tx: {
    $queryRaw: jest.Mock;
    $executeRaw: jest.Mock;
    incident: { create: jest.Mock; findFirst: jest.Mock };
  };
  let client: Prisma.TransactionClient;
  let repository: IncidentsRepository;

  beforeEach(() => {
    tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      $executeRaw: jest.fn().mockResolvedValue(0),
      incident: {
        create: jest.fn().mockResolvedValue(ROW),
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    client = tx as unknown as Prisma.TransactionClient;
    repository = new IncidentsRepository();
  });

  it('locks the open incident on the supplied connection, excluding CLOSED', async () => {
    await expect(repository.lockOpenByDevice('device-1', client)).resolves.toBeNull();
    tx.$queryRaw.mockResolvedValue([ROW]);
    await expect(repository.lockOpenByDevice('device-1', client)).resolves.toBe(ROW);
    const [sql, deviceId] = tx.$queryRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(sql.join('?')).toContain('"state" <> \'CLOSED\'');
    expect(sql.join('?')).toContain('FOR UPDATE');
    expect(deviceId).toBe('device-1');
  });

  it('creates with schema defaults and the first code of the processing UTC year', async () => {
    await expect(repository.insert(INPUT, NOW, client)).resolves.toEqual({
      incident: ROW,
      created: true,
    });
    expect(tx.incident.create).toHaveBeenCalledWith({
      data: { ...INPUT, code: 'INC-2026-000001', stateChangedAt: NOW, createdAt: NOW },
    });
    expect(tx.incident.findFirst).toHaveBeenCalledWith({
      where: { code: { startsWith: 'INC-2026-' } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    expect(
      tx.$executeRaw.mock.calls.map(([sql]) => (sql as TemplateStringsArray).join('?')),
    ).toEqual([
      'SELECT pg_advisory_xact_lock(hashtext(?))',
      'SAVEPOINT incident_insert',
      'RELEASE SAVEPOINT incident_insert',
    ]);
  });

  it('increments an existing code without using the occurrence year of a late event', async () => {
    tx.incident.findFirst.mockResolvedValue({ code: 'INC-2027-000044' });
    await repository.insert(INPUT, new Date('2026-12-31T23:30:00-01:00'), client);
    expect(tx.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'INC-2027-000045' }) as unknown,
    });
    const [, scope] = tx.$executeRaw.mock.calls[0] as [TemplateStringsArray, string];
    expect(scope).toBe('incidents:code:2027');
  });

  it('allows the final six-digit number', async () => {
    tx.incident.findFirst.mockResolvedValue({ code: 'INC-2026-999998' });
    await repository.insert(INPUT, NOW, client);
    expect(tx.incident.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ code: 'INC-2026-999999' }) as unknown,
    });
  });

  it.each(['999999', 'invalid', '-00002'])(
    'refuses exhausted or corrupt suffix %s',
    async (suffix) => {
      tx.incident.findFirst.mockResolvedValue({ code: `INC-2026-${suffix}` });
      await expect(repository.insert(INPUT, NOW, client)).rejects.toThrow(RangeError);
      expect(tx.incident.create).not.toHaveBeenCalled();
    },
  );

  it.each([
    new Date('invalid'),
    new Date('+010000-01-01T00:00:00Z'),
    new Date('-000001-01-01T00:00:00Z'),
  ])('rejects an invalid or out-of-range year', async (at) => {
    await expect(repository.insert(INPUT, at, client)).rejects.toThrow(RangeError);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });

  it.each(['incidents_one_open_per_device', ['deviceId']])(
    'returns the winning incident for partial-unique target %j',
    async (target) => {
      tx.incident.create.mockRejectedValue(uniqueError(target));
      tx.$queryRaw.mockResolvedValue([ROW]);
      await expect(repository.insert(INPUT, NOW, client)).resolves.toEqual({
        incident: ROW,
        created: false,
      });
      const statements = tx.$executeRaw.mock.calls.map(([sql]) =>
        (sql as TemplateStringsArray).join('?'),
      );
      expect(statements.slice(-2)).toEqual([
        'ROLLBACK TO SAVEPOINT incident_insert',
        'RELEASE SAVEPOINT incident_insert',
      ]);
      expect(tx.$executeRaw.mock.invocationCallOrder.at(-1)).toBeLessThan(
        tx.$queryRaw.mock.invocationCallOrder[0],
      );
    },
  );

  it('preserves the error when a competing incident closed before recovery', async () => {
    const error = uniqueError(['deviceId']);
    tx.incident.create.mockRejectedValue(error);
    await expect(repository.insert(INPUT, NOW, client)).rejects.toBe(error);
  });

  it.each([
    uniqueError(['code']),
    uniqueError(['openedByEventId']),
    uniqueError(['deviceId', 'code']),
    uniqueError(),
    uniqueError('another_constraint'),
    uniqueError(['deviceId'], 'P2003'),
    new Error('connection lost'),
  ])('does not misclassify other insert errors as correlation conflicts', async (error) => {
    tx.incident.create.mockRejectedValue(error);
    await expect(repository.insert(INPUT, NOW, client)).rejects.toBe(error);
    expect(tx.$queryRaw).not.toHaveBeenCalled();
  });
});
