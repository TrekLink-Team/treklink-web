import { bootE2e, E2eApp, envelope } from './e2e-callers';

// organizations task 4.2, the part the stubbed pipeline can prove: authentication, the role rules of
// the permission matrix, the Validation rows of api-design 01 to 32 that the ValidationPipe decides
// before any read, and tenant isolation, where another organization's `:id` answers 404 (REQ-ERR-05,
// FR-AUTH-11). The AC-01 to AC-11 flows, the 409 rows and the races run on Postgres in the
// `*.db-spec.ts` files of this module (`test:db`).

const ORG_B = '0b0ffee0-1234-4abc-9def-0011223344b1';
const ID = '0c0ffee0-1234-4abc-9def-001122334455';
const MEMBER = '0d0ffee0-1234-4abc-9def-001122334466';
const SHIFT = '0e0ffee0-1234-4abc-9def-001122334477';

type Method = 'get' | 'post' | 'patch' | 'delete';
type Role = 'staff-1' | 'admin-1' | 'manager-a' | 'operator-a';

interface Route {
  method: Method;
  path: string;
  // A body that passes validation.
  body?: object;
  // The roles the permission matrix does not grant the route to.
  refused: Role[];
}

const ORG_SIDE: Role[] = ['manager-a', 'operator-a'];
const MANAGER_ONLY: Role[] = ['staff-1', 'admin-1', 'operator-a'];
const WINDOW = { startsAt: '2030-01-01T00:00:00Z', endsAt: '2030-01-01T08:00:00Z' };
const VERSION = { expectedVersion: 0 };

const ROUTES: Route[] = [
  {
    method: 'get',
    path: '/api/organizations',
    refused: ORG_SIDE,
  },
  { method: 'get', path: `/api/organizations/${ID}`, refused: [] },
  {
    method: 'patch',
    path: `/api/organizations/${ID}`,
    body: { address: '1 Test Street', ...VERSION },
    refused: ['staff-1', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/verification`,
    body: {},
    refused: ['manager-a', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/approve`,
    body: VERSION,
    refused: ['staff-1', ...ORG_SIDE],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/reject`,
    body: { reason: 'No licence', ...VERSION },
    refused: ['staff-1', ...ORG_SIDE],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/suspend`,
    body: { reason: 'Unpaid', ...VERSION },
    refused: ['staff-1', ...ORG_SIDE],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/reactivate`,
    body: VERSION,
    refused: ['staff-1', ...ORG_SIDE],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/close`,
    body: { reason: 'Left', ...VERSION },
    refused: ['staff-1', ...ORG_SIDE],
  },
  {
    method: 'get',
    path: `/api/organizations/${ID}/transitions`,
    refused: [],
  },
  { method: 'get', path: `/api/organizations/${ID}/members`, refused: [] },
  {
    method: 'post',
    path: `/api/organizations/${ID}/members`,
    body: { email: 'op@acme.vn', fullName: 'Op One', role: 'OPERATOR' },
    refused: ['staff-1', 'admin-1', 'operator-a'],
  },
  {
    method: 'patch',
    path: `/api/organizations/${ID}/members/${MEMBER}`,
    body: { role: 'MANAGER' },
    refused: MANAGER_ONLY,
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/members/${MEMBER}/deactivate`,
    body: {},
    refused: MANAGER_ONLY,
  },
  {
    method: 'get',
    path: `/api/organizations/${ID}/roster?from=2030-01-01T00:00:00Z&to=2030-01-08T00:00:00Z`,
    refused: ['staff-1', 'admin-1'],
  },
  { method: 'post', path: `/api/organizations/${ID}/roster`, body: WINDOW, refused: MANAGER_ONLY },
  {
    method: 'patch',
    path: `/api/organizations/${ID}/roster/${SHIFT}`,
    body: WINDOW,
    refused: MANAGER_ONLY,
  },
  { method: 'delete', path: `/api/organizations/${ID}/roster/${SHIFT}`, refused: MANAGER_ONLY },
  { method: 'get', path: `/api/organizations/${ID}/api-keys`, refused: ['operator-a'] },
  {
    method: 'post',
    path: `/api/organizations/${ID}/api-keys`,
    body: { name: 'Gateway' },
    refused: ['staff-1', 'admin-1', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/api-keys/${ID}/revoke`,
    body: {},
    refused: ['staff-1', 'admin-1', 'operator-a'],
  },
  { method: 'get', path: `/api/organizations/${ID}/field-stations`, refused: [] },
  {
    method: 'post',
    path: `/api/organizations/${ID}/field-stations`,
    body: { name: 'Station 1' },
    refused: ['staff-1', 'admin-1', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/organizations/${ID}/field-stations/${ID}/revoke`,
    body: {},
    refused: ['operator-a'],
  },
  { method: 'get', path: `/api/organizations/${ID}/field-stations/release`, refused: [] },
  {
    method: 'post',
    path: `/api/organizations/${ID}/channel-key/rotate`,
    body: { reason: 'Exposed', ...VERSION },
    refused: ORG_SIDE,
  },
  { method: 'get', path: '/api/compliance-cases', refused: ['manager-a', 'operator-a'] },
  { method: 'get', path: `/api/compliance-cases/${ID}`, refused: ['manager-a', 'operator-a'] },
  {
    method: 'post',
    path: `/api/organizations/${ID}/compliance-cases`,
    body: { type: 'OTHER_BREACH', evidence: 'Photo' },
    refused: ['manager-a', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/compliance-cases/${ID}/actions`,
    body: { kind: 'NOTE', note: 'Called them' },
    refused: ['manager-a', 'operator-a'],
  },
  {
    method: 'post',
    path: `/api/compliance-cases/${ID}/close`,
    body: { outcome: 'Settled' },
    refused: ['manager-a', 'operator-a'],
  },
];

describe('organizations (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2e({});
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  const expectError = (
    response: Awaited<ReturnType<E2eApp['send']>>,
    status: number,
    errorCode: string,
  ) => {
    expect(response.status).toBe(status);
    expect(envelope(response)).toMatchObject({
      isSuccess: false,
      statusCode: status,
      result: { errorCode },
    });
  };

  describe('authentication', () => {
    it.each(ROUTES.map((route) => [route.method, route.path.split('?')[0], route] as const))(
      'answers 401 without a token: %s %s',
      async (_method, _path, route) => {
        expectError(
          await e2e.send(null, route.method, route.path, route.body),
          401,
          'UNAUTHENTICATED',
        );
      },
    );
  });

  describe('roles of the permission matrix', () => {
    const refusals = ROUTES.flatMap((route) =>
      route.refused.map((role) => [route.method, route.path.split('?')[0], role, route] as const),
    );

    it.each(refusals)('refuses %s %s to %s (403)', async (_method, _path, role, route) => {
      expectError(await e2e.send(role, route.method, route.path, route.body), 403, 'FORBIDDEN');
    });
  });

  describe('Validation rows (400 VALIDATION_FAILED)', () => {
    const REGISTER = {
      legalName: 'ACME Trek Co., Ltd.',
      taxCode: '0312345678',
      address: '12 Nguyen Hue, District 1',
      contactPhone: '0281234567',
      managerFullName: 'Nguyen Van A',
      managerEmail: 'a@acme-trek.vn',
      managerPhone: '0901234567',
    };

    it.each([
      ['a missing legal name', { legalName: undefined }],
      ['a tax code of 9 digits', { taxCode: '031234567' }],
      ['a contact phone with letters', { contactPhone: 'call me' }],
      ['a manager email that is not an email', { managerEmail: 'a@' }],
      ['a manager name over 120 characters', { managerFullName: 'x'.repeat(121) }],
    ])('api-design 01 refuses %s, with no token', async (_, change) => {
      expectError(
        await e2e.send(null, 'post', '/api/organizations/register', { ...REGISTER, ...change }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('api-design 02 refuses a status that does not exist and a page size of 0', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/organizations?status=ODD'),
        400,
        'VALIDATION_FAILED',
      );
      expectError(
        await e2e.send('staff-1', 'get', '/api/organizations?limit=0'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('refuses an :id that is not a uuid on every route', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/organizations/not-a-uuid'),
        400,
        'VALIDATION_FAILED',
      );
      expectError(
        await e2e.send('admin-1', 'post', '/api/organizations/not-a-uuid/close', {
          reason: 'x',
          ...VERSION,
        }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it.each([
      ['04 without a field', 'admin-1', 'patch', `/api/organizations/${ID}`, VERSION],
      [
        '04 with a phone that is not a phone',
        'admin-1',
        'patch',
        `/api/organizations/${ID}`,
        { contactPhone: 'x', ...VERSION },
      ],
      ['04 without the version', 'admin-1', 'patch', `/api/organizations/${ID}`, { address: 'x' }],
      ['05 with an empty body', 'staff-1', 'post', `/api/organizations/${ID}/verification`, {}],
      ['06 without the version', 'admin-1', 'post', `/api/organizations/${ID}/approve`, {}],
      ['07 without a reason', 'admin-1', 'post', `/api/organizations/${ID}/reject`, VERSION],
      [
        '08 with a blank reason',
        'admin-1',
        'post',
        `/api/organizations/${ID}/suspend`,
        { reason: '  ', ...VERSION },
      ],
      ['09 without the version', 'admin-1', 'post', `/api/organizations/${ID}/reactivate`, {}],
      [
        '10 with a reason over 500 characters',
        'admin-1',
        'post',
        `/api/organizations/${ID}/close`,
        { reason: 'x'.repeat(501), ...VERSION },
      ],
      [
        '13 with a role that does not exist',
        'manager-a',
        'post',
        `/api/organizations/${ID}/members`,
        { email: 'op@acme.vn', fullName: 'Op', role: 'ADMIN' },
      ],
      [
        '13 with an email that is not an email',
        'manager-a',
        'post',
        `/api/organizations/${ID}/members`,
        { email: 'op', fullName: 'Op', role: 'OPERATOR' },
      ],
      [
        '14 with a role that does not exist',
        'manager-a',
        'patch',
        `/api/organizations/${ID}/members/${MEMBER}`,
        { role: 'ADMIN' },
      ],
      ['16 without the window', 'manager-a', 'get', `/api/organizations/${ID}/roster`, undefined],
      [
        '16 with a window that has no zone',
        'manager-a',
        'get',
        `/api/organizations/${ID}/roster?from=2030-01-01T00:00:00&to=2030-01-08T00:00:00`,
        undefined,
      ],
      [
        '17 without the end',
        'manager-a',
        'post',
        `/api/organizations/${ID}/roster`,
        { startsAt: WINDOW.startsAt },
      ],
      [
        '17 with a member that is not a uuid',
        'manager-a',
        'post',
        `/api/organizations/${ID}/roster`,
        { ...WINDOW, primaryMemberId: 'm-1' },
      ],
      ['21 without a name', 'manager-a', 'post', `/api/organizations/${ID}/api-keys`, {}],
      ['24 without a name', 'manager-a', 'post', `/api/organizations/${ID}/field-stations`, {}],
      [
        '27 without a reason',
        'staff-1',
        'post',
        `/api/organizations/${ID}/channel-key/rotate`,
        VERSION,
      ],
      [
        '28 with a status that does not exist',
        'staff-1',
        'get',
        '/api/compliance-cases?status=ODD',
        undefined,
      ],
      [
        '29 with a type that does not exist',
        'staff-1',
        'post',
        `/api/organizations/${ID}/compliance-cases`,
        { type: 'ODD', evidence: 'x' },
      ],
      [
        '29 without evidence',
        'staff-1',
        'post',
        `/api/organizations/${ID}/compliance-cases`,
        { type: 'OTHER_BREACH' },
      ],
      [
        '30 with an action that does not exist',
        'staff-1',
        'post',
        `/api/compliance-cases/${ID}/actions`,
        { kind: 'ODD', note: 'x' },
      ],
      ['31 without the outcome', 'staff-1', 'post', `/api/compliance-cases/${ID}/close`, {}],
    ] as const)('api-design %s', async (_, role, method, path, body) => {
      expectError(await e2e.send(role, method, path, body), 400, 'VALIDATION_FAILED');
    });
  });

  describe('tenant isolation: another organization is 404', () => {
    // manager-a belongs to org-a; every route of the module with an :id of another organization.
    const manager = ROUTES.filter(
      (route) =>
        route.path.includes('/api/organizations/') &&
        !route.refused.includes('manager-a') &&
        !route.path.endsWith('/release'),
    ).map((route) => [route.method, route.path.split('?')[0], route] as const);

    it.each(manager)(
      'answers 404 to a Manager of another organization: %s %s',
      async (_m, _p, route) => {
        const path = route.path.replace(ID, ORG_B);
        expectError(await e2e.send('manager-a', route.method, path, route.body), 404, 'NOT_FOUND');
      },
    );
  });
});
