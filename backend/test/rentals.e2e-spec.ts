import { bootE2e, E2eApp, envelope } from './e2e-callers';

// rentals task 6.2, the part the stubbed pipeline can prove: the Validation rows of api-design 01 to
// 11 and 18 that the guards and the ValidationPipe decide before any service runs, the role rules of
// the permission matrix, and tenant isolation of the contract reads (another organization's contract
// is 404, FR-AUTH-11). The AC-01 to AC-07 flows and the 50 parallel approvals need Postgres
// (`test:db`) and stay open.

const C = '0c0ffee0-1234-4abc-9def-001122334455';
const OTHER = '0c0ffee0-1234-4abc-9def-0011223344aa';
const D = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';
const VARIANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

// Another organization's contract, as ContractsRepository.detail selects it.
const contractOfOrgB = {
  id: OTHER,
  code: 'RC-2026-0099',
  organizationId: 'org-b',
  status: 'ACTIVE',
  devices: [],
  terms: [],
};

describe('rentals (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2e({
      rentalContract: {
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(where.id === OTHER ? contractOfOrgB : null),
      },
    });
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

  describe('authentication and roles', () => {
    it('answers 401 without a token', async () => {
      expectError(await e2e.send(null, 'get', '/api/contracts'), 401, 'UNAUTHENTICATED');
    });

    it('refuses a request from an Org Operator (contract.request.own is the Manager’s)', async () => {
      const response = await e2e.send('operator-a', 'post', '/api/contracts', {
        planType: 'MONTHLY',
        hardwareVariantId: VARIANT,
        quantity: 5,
        requestedStartDate: '2026-11-01',
      });
      expectError(response, 403, 'FORBIDDEN');
    });

    it.each([
      ['approve', { handoverAt: '2026-11-01T02:00:00Z', expectedVersion: 0 }],
      ['reject', { reason: 'Out of stock', expectedVersion: 0 }],
    ])('refuses %s to an Org Manager (contract.operate is Staff’s)', async (action, body) => {
      expectError(
        await e2e.send('manager-a', 'post', `/api/contracts/${C}/${action}`, body),
        403,
        'FORBIDDEN',
      );
    });

    it.each([
      [`/api/contracts/${C}/devices/${D}/swap`, { reason: 'No GPS fix' }],
      [`/api/contracts/${C}/devices/${D}/provisioning`, { keyVersion: 1 }],
    ])('refuses the counter steps to an Org Manager: %s', async (path, body) => {
      expectError(await e2e.send('manager-a', 'post', path, body), 403, 'FORBIDDEN');
    });

    it('refuses notice to an Org Operator', async () => {
      expectError(
        await e2e.send('operator-a', 'post', `/api/contracts/${C}/notice`, { expectedVersion: 0 }),
        403,
        'FORBIDDEN',
      );
    });
  });

  describe('Validation rows (400 VALIDATION_FAILED)', () => {
    it.each([
      ['an unknown plan', { planType: 'WEEKLY' }],
      ['a quantity of 0', { quantity: 0 }],
      ['a variant that is not a uuid', { hardwareVariantId: 'treklink-v3' }],
      ['a start date that is not yyyy-mm-dd', { requestedStartDate: '01/11/2026' }],
      ['a day plan without its length', { planType: 'DAY' }],
    ])('api-design 01 refuses %s', async (_, change) => {
      const response = await e2e.send('manager-a', 'post', '/api/contracts', {
        planType: 'MONTHLY',
        hardwareVariantId: VARIANT,
        quantity: 5,
        requestedStartDate: '2026-11-01',
        ...change,
      });
      expectError(response, 400, 'VALIDATION_FAILED');
    });

    it('api-design 02 refuses a malformed organization UUID', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/contracts?organizationId=ORG-0001'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('api-design 02 refuses an unknown status filter', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/contracts?status=LOST'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it.each([
      ['a handover time that is not a date', { handoverAt: 'tomorrow', expectedVersion: 0 }],
      ['a negative version', { handoverAt: '2026-11-01T02:00:00Z', expectedVersion: -1 }],
      ['a missing version', { handoverAt: '2026-11-01T02:00:00Z' }],
      [
        'an invalid device UUID',
        { handoverAt: '2026-11-01T02:00:00Z', expectedVersion: 0, deviceIds: ['TL-0001'] },
      ],
      [
        'duplicate devices',
        { handoverAt: '2026-11-01T02:00:00Z', expectedVersion: 0, deviceIds: [D, D] },
      ],
    ])('api-design 04 refuses %s', async (_, body) => {
      expectError(
        await e2e.send('staff-1', 'post', `/api/contracts/${C}/approve`, body),
        400,
        'VALIDATION_FAILED',
      );
    });

    it.each([
      ['an empty reason', { reason: '', expectedVersion: 0 }],
      ['a reason over 500 characters', { reason: 'x'.repeat(501), expectedVersion: 0 }],
    ])('api-design 05 refuses %s', async (_, body) => {
      expectError(
        await e2e.send('staff-1', 'post', `/api/contracts/${C}/reject`, body),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('api-design 07 refuses a swap without a reason', async () => {
      expectError(
        await e2e.send('staff-1', 'post', `/api/contracts/${C}/devices/${D}/swap`, { reason: '' }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('api-design 09 refuses a key version below 1', async () => {
      expectError(
        await e2e.send('staff-1', 'post', `/api/contracts/${C}/devices/${D}/provisioning`, {
          keyVersion: 0,
        }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it.each([
      ['a battery reading above 100', { batteryPct: 101 }],
      ['a device id that is not a uuid', { deviceId: 'TL-0001' }],
    ])('api-design 10 refuses a device check with %s', async (_, change) => {
      const response = await e2e.send('staff-1', 'post', `/api/contracts/${C}/handover`, {
        signedByMemberId: D,
        identityChecked: 'CCCD ...1234',
        signaturePng: 'iVBORw0KGgo=',
        deviceChecks: [{ deviceId: D, batteryPct: 80, gpsFixOk: true, ...change }],
        expectedVersion: 1,
      });
      expectError(response, 400, 'VALIDATION_FAILED');
    });

    it('api-design 12 refuses notice without the version', async () => {
      expectError(
        await e2e.send('manager-a', 'post', `/api/contracts/${C}/notice`, {}),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('api-design 13 refuses a holder phone over 30 characters', async () => {
      expectError(
        await e2e.send('manager-a', 'put', `/api/contracts/${C}/devices/${D}/holder`, {
          name: 'Nguyen Van A',
          phone: '0'.repeat(31),
        }),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('refuses a contract id that is not a uuid', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/contracts/RC-2026-0001'),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('tenant isolation (FR-AUTH-11)', () => {
    it.each([`/api/contracts/${OTHER}`, `/api/contracts/${OTHER}/transitions`])(
      "answers 404 to an Org Manager for another organization's contract: %s",
      async (path) => {
        const response = await e2e.send('manager-a', 'get', path);
        expectError(response, 404, 'NOT_FOUND');
        expect(envelope(response).message).toBe('Contract not found.');
      },
    );

    it('answers 404 for a contract that does not exist', async () => {
      expectError(await e2e.send('staff-1', 'get', `/api/contracts/${C}`), 404, 'NOT_FOUND');
    });
  });
});
