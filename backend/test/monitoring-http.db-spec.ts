import { AccountType } from '@prisma/client';
import { Caller } from '../src/common/decorators/access.decorator';
import { ReplayService } from '../src/modules/monitoring/replay.service';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface Envelope {
  result: { errorCode?: string };
  isSuccess: boolean;
  statusCode: number;
}

// A uuid no device carries.
const NO_DEVICE = '00000000-0000-4000-8000-000000000000';
const RANGE = 'from=2026-11-01T00:00:00Z&to=2026-11-02T00:00:00Z';

interface Row {
  endpoint: string;
  case: string;
  status: number;
  errorCode: string;
  call: () => PromiseLike<{ status: number; body: unknown }>;
}

// Monitoring task 4.2: the Validation rows of api-design 01 to 08 through the real HTTP pipeline, the
// guards and the services, on PostgreSQL. Each row calls its route as the account that earns the status
// and checks the status and the `errorCode` of the envelope (D-002, D-026). The 429 of api-design 04 is
// in `org-api-http.db-spec.ts`; the 410 of api-design 05 needs a stream that has outlived its retention,
// which a database shared with other suites cannot be made to hold, so `ReplayService.isExpired` is the
// one method replaced there. Fixtures are fresh organizations and accounts; nothing is deleted.
describe('monitoring Validation rows over HTTP (task 4.2, api-design 01 to 08)', () => {
  let flow: RentalFlow;
  const who: Partial<Record<'staff' | 'admin' | 'manager' | 'otherManager' | 'operator', Caller>> =
    {};
  let apiKey: string;
  let rateLimit: number;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
    who.staff = flow.staff;
    who.admin = await flow.admin();
    const org = await flow.organization();
    who.manager = org.manager;
    who.otherManager = (await flow.organization()).manager;
    who.operator = {
      id: await flow.user(AccountType.ORGANIZATION, 'ORG_OPERATOR'),
      roles: ['ORG_OPERATOR'],
      organizationId: org.id,
    };
    const operator = who.operator;
    await flow.prisma.organizationMember.create({
      data: { userId: operator.id, organizationId: org.id, role: 'OPERATOR' },
    });
    const created = await flow.send(org.manager, 'post', `/api/organizations/${org.id}/api-keys`, {
      name: 'monitoring-http',
    });
    apiKey = (created.body as { result: { key: string } }).result.key;
    rateLimit = Number(
      (await flow.seededParameters(['monitoring.apiRateLimitPerMinute']))[
        'monitoring.apiRateLimitPerMinute'
      ],
    );
  }, 120_000);
  afterAll(async () => {
    jest.restoreAllMocks();
    await flow?.close();
  });

  const as = (name: keyof typeof who, path: string) => () => {
    const caller = who[name];
    if (!caller) throw new Error(`No ${name} caller.`);
    return flow.send(caller, 'get', path);
  };
  const withKey = (path: string) => () => flow.sendKey(apiKey, path);
  const anonymous = (path: string) => () => flow.sendKey('', path);

  const rows: Row[] = [
    // 01 GET /api/map/config
    {
      endpoint: '01',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/map/config'),
    },
    {
      endpoint: '01',
      case: 'an API key',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: withKey('/api/map/config'),
    },
    // 02 GET /api/map/snapshot
    {
      endpoint: '02',
      case: 'organizationId is not a uuid',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/map/snapshot?organizationId=not-a-uuid'),
    },
    {
      endpoint: '02',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/map/snapshot'),
    },
    {
      endpoint: '02',
      case: 'an API key',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: withKey('/api/map/snapshot'),
    },
    // 03 GET /api/telemetry/devices/:id/history
    {
      endpoint: '03',
      case: 'to before from',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as(
        'staff',
        `/api/telemetry/devices/${NO_DEVICE}/history?from=2026-11-02T00:00:00Z&to=2026-11-01T00:00:00Z`,
      ),
    },
    {
      endpoint: '03',
      case: 'a range over the limit',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as(
        'staff',
        `/api/telemetry/devices/${NO_DEVICE}/history?from=2026-10-01T00:00:00Z&to=2026-10-30T00:00:00Z`,
      ),
    },
    {
      endpoint: '03',
      case: 'from is missing',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', `/api/telemetry/devices/${NO_DEVICE}/history?to=2026-11-02T00:00:00Z`),
    },
    {
      endpoint: '03',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous(`/api/telemetry/devices/${NO_DEVICE}/history?${RANGE}`),
    },
    {
      endpoint: '03',
      case: 'an API key',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: withKey(`/api/telemetry/devices/${NO_DEVICE}/history?${RANGE}`),
    },
    {
      endpoint: '03',
      case: 'an unknown device, as Staff',
      status: 404,
      errorCode: 'NOT_FOUND',
      call: as('staff', `/api/telemetry/devices/${NO_DEVICE}/history?${RANGE}`),
    },
    {
      endpoint: '03',
      case: 'a device the organization never rented, as its Manager',
      status: 404,
      errorCode: 'NOT_FOUND',
      call: as('otherManager', `/api/telemetry/devices/${NO_DEVICE}/history?${RANGE}`),
    },
    // 04 GET /api/telemetry/devices
    {
      endpoint: '04',
      case: 'no key',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/telemetry/devices'),
    },
    {
      endpoint: '04',
      case: 'an access token',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('staff', '/api/telemetry/devices'),
    },
    // 05 GET /api/telemetry/stream
    {
      endpoint: '05',
      case: 'after is missing',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: withKey('/api/telemetry/stream'),
    },
    {
      endpoint: '05',
      case: 'limit over the batch size',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: withKey('/api/telemetry/stream?after=0&limit=100000'),
    },
    {
      endpoint: '05',
      case: 'no key',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/telemetry/stream?after=0'),
    },
    {
      endpoint: '05',
      case: 'an access token',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('staff', '/api/telemetry/stream?after=0'),
    },
    // 06 GET /api/system-health
    {
      endpoint: '06',
      case: 'windowMinutes is 0',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('admin', '/api/system-health?windowMinutes=0'),
    },
    {
      endpoint: '06',
      case: 'windowMinutes is over a day',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('admin', '/api/system-health?windowMinutes=1441'),
    },
    {
      endpoint: '06',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/system-health'),
    },
    {
      endpoint: '06',
      case: 'Staff',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('staff', '/api/system-health'),
    },
    {
      endpoint: '06',
      case: 'an organization Manager',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('manager', '/api/system-health'),
    },
    // 07 GET /api/devices/:id/history
    {
      endpoint: '07',
      case: 'the id is not a uuid',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/devices/not-a-uuid/history'),
    },
    {
      endpoint: '07',
      case: 'pageSize is 0',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', `/api/devices/${NO_DEVICE}/history?pageSize=0`),
    },
    {
      endpoint: '07',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous(`/api/devices/${NO_DEVICE}/history`),
    },
    {
      endpoint: '07',
      case: 'an organization Operator',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('operator', `/api/devices/${NO_DEVICE}/history`),
    },
    {
      endpoint: '07',
      case: 'an unknown device',
      status: 404,
      errorCode: 'NOT_FOUND',
      call: as('staff', `/api/devices/${NO_DEVICE}/history`),
    },
    // 08 GET /api/reports/:kind
    {
      endpoint: '08',
      case: 'an unknown kind',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/reports/payroll?from=2026-11-01&to=2026-12-01'),
    },
    {
      endpoint: '08',
      case: 'from is missing',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/reports/revenue?to=2026-12-01'),
    },
    {
      endpoint: '08',
      case: 'to before from',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/reports/revenue?from=2026-12-01&to=2026-11-01'),
    },
    {
      endpoint: '08',
      case: 'a period over the limit',
      status: 400,
      errorCode: 'VALIDATION_FAILED',
      call: as('staff', '/api/reports/revenue?from=2024-01-01&to=2026-12-01'),
    },
    {
      endpoint: '08',
      case: 'no credential',
      status: 401,
      errorCode: 'UNAUTHENTICATED',
      call: anonymous('/api/reports/revenue?from=2026-11-01&to=2026-12-01'),
    },
    {
      endpoint: '08',
      case: 'an organization Manager',
      status: 403,
      errorCode: 'FORBIDDEN',
      call: as('manager', '/api/reports/revenue?from=2026-11-01&to=2026-12-01'),
    },
  ];

  it.each(rows)('api-design $endpoint: $case answers $status', async (row) => {
    const response = await row.call();
    expect(response.status).toBe(row.status);
    const body = response.body as Envelope;
    expect(body.isSuccess).toBe(false);
    expect(body.statusCode).toBe(row.status);
    expect(body.result.errorCode).toBe(row.errorCode);
  });

  it('api-design 05: a cursor that has left the retention window answers 410 CURSOR_EXPIRED', async () => {
    jest.spyOn(flow.get(ReplayService), 'isExpired').mockResolvedValue(true);
    const response = await flow.sendKey(apiKey, '/api/telemetry/stream?after=0');
    expect(response.status).toBe(410);
    expect((response.body as Envelope).result.errorCode).toBe('CURSOR_EXPIRED');
    jest.restoreAllMocks();
  });

  it('api-design 05: the call after the limit of the minute answers 429 RATE_LIMITED', async () => {
    const org = await flow.organization();
    const created = await flow.send(org.manager, 'post', `/api/organizations/${org.id}/api-keys`, {
      name: 'stream-limit',
    });
    const { key } = (created.body as { result: { key: string } }).result;
    for (let call = 1; call <= rateLimit; call++) {
      expect((await flow.sendKey(key, '/api/telemetry/stream?after=0')).status).toBe(200);
    }
    const refused = await flow.sendKey(key, '/api/telemetry/stream?after=0');
    expect(refused.status).toBe(429);
    expect((refused.body as Envelope).result.errorCode).toBe('RATE_LIMITED');
  });
});
