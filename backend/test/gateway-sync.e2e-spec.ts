import { bootE2e, Caller, E2eApp, envelope } from './e2e-callers';

// gateway-sync api-design 04 and 07 through the real HTTP pipeline, Prisma stubbed: `listAudit` and
// `syncStatus` answer TrekLink Staff and Admin, who hold `fieldEvent.read` (and `fieldStation.read`
// for `syncStatus`), and refuse an Org Manager and an Org Operator with the 403 envelope, because no
// organization role holds `fieldEvent.read` (seed migration 20261004120100). Nothing is read for a
// refused caller.

const AUDIT_ROW = {
  id: 'audit-1',
  eventId: null,
  nodeNum: null,
  deviceId: null,
  uplinkKey: 'gw-01',
  ingress: 'MQTT',
  outcome: 'MALFORMED_ENVELOPE',
  detail: 'not JSON',
  rawMessage: 'garbage',
  createdAt: new Date('2026-10-31T10:00:00Z'),
};

const PARAMETER = {
  key: 'monitoring.fieldStationStaleSeconds',
  value: 180,
  valueType: 'INTEGER',
  bounds: null,
  unit: 'seconds',
  ownerModule: 'monitoring',
  description: null,
  version: 1,
  updatedAt: new Date('2026-10-01T00:00:00Z'),
};

const resultOf = <T>(response: { body: unknown }) => (response.body as { result: T }).result;

describe('gateway-sync reads by role (e2e)', () => {
  let e2e: E2eApp;
  const auditRows = jest.fn();
  const groupBy = jest.fn();

  beforeAll(async () => {
    e2e = await bootE2e({
      syncAuditLog: {
        findMany: auditRows.mockResolvedValue([AUDIT_ROW]),
        count: () => Promise.resolve(1),
        groupBy: groupBy.mockResolvedValue([{ outcome: 'ACCEPTED', _count: { _all: 3 } }]),
      },
      fieldEvent: { findFirst: () => Promise.resolve(null) },
      fieldStation: { findMany: () => Promise.resolve([]) },
      businessParameter: { findUnique: () => Promise.resolve(PARAMETER) },
    });
  });

  beforeEach(() => {
    auditRows.mockClear();
    groupBy.mockClear();
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  const allowed: Caller[] = ['staff-1', 'admin-1'];
  const refused: Caller[] = ['manager-a', 'operator-a'];

  it.each(allowed)('answers listAudit with 200 for %s', async (caller) => {
    const response = await e2e.send(caller, 'post', '/api/gateway-sync', { op: 'listAudit' });

    expect(response.status).toBe(200);
    expect(envelope(response)).toMatchObject({ isSuccess: true, statusCode: 200 });
    const { items } = resultOf<{ items: unknown[] }>(response);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: 'audit-1',
      outcome: 'MALFORMED_ENVELOPE',
      rawExcerpt: 'garbage',
    });
  });

  it.each(allowed)('answers syncStatus with 200 for %s', async (caller) => {
    const response = await e2e.send(caller, 'post', '/api/gateway-sync', { op: 'syncStatus' });

    expect(response.status).toBe(200);
    expect(envelope(response)).toMatchObject({ isSuccess: true, statusCode: 200 });
    expect(resultOf<unknown>(response)).toMatchObject({
      staleAfterSeconds: 180,
      fieldStations: [],
      ingestion: { accepted: 3, windowMinutes: 60 },
    });
  });

  it.each(refused)('answers listAudit with 403 for %s and reads nothing', async (caller) => {
    const response = await e2e.send(caller, 'post', '/api/gateway-sync', { op: 'listAudit' });

    expect(response.status).toBe(403);
    expect(envelope(response)).toMatchObject({ isSuccess: false, statusCode: 403 });
    expect(auditRows).not.toHaveBeenCalled();
  });

  it.each(refused)('answers syncStatus with 403 for %s and reads nothing', async (caller) => {
    const response = await e2e.send(caller, 'post', '/api/gateway-sync', { op: 'syncStatus' });

    expect(response.status).toBe(403);
    expect(envelope(response)).toMatchObject({ isSuccess: false, statusCode: 403 });
    expect(groupBy).not.toHaveBeenCalled();
  });
});
