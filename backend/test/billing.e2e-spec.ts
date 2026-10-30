import { bootE2e, E2eApp, envelope } from './e2e-callers';

// billing task 5.2, the part the stubbed pipeline can prove: the Validation rows of api-design 02, 08
// to 10, 13 and 14 that the guards and the ValidationPipe decide, the role rules of the permission
// matrix, and tenant isolation of the invoice and balance reads (FR-AUTH-11). The webhook replay
// (api-design 12) joins with the SePay task (#92), and AC-01 to AC-05 need Postgres (`test:db`).

const INVOICE_B = '1a2b3c4d-0000-4abc-9def-0000000000b1';
const CONTRACT_B = '0c0ffee0-1234-4abc-9def-0011223344bb';
const MISSING = '1a2b3c4d-0000-4abc-9def-000000000000';
const VARIANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

describe('billing (e2e)', () => {
  let e2e: E2eApp;

  beforeAll(async () => {
    e2e = await bootE2e({
      invoice: {
        // The invoice detail (api-design 09): another organization's invoice.
        findUnique: ({ where }: { where: { id: string } }) =>
          Promise.resolve(
            where.id === INVOICE_B
              ? { id: INVOICE_B, organizationId: 'org-b', contractId: CONTRACT_B, lines: [] }
              : null,
          ),
        // The owner of a contract's invoices, for the balance (api-design 10).
        findFirst: ({ where }: { where: { contractId?: string } }) =>
          Promise.resolve(where.contractId === CONTRACT_B ? { organizationId: 'org-b' } : null),
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

  const COUNTER = { method: 'CASH', amountVnd: 1_125_000, reference: 'RCPT-0001' };

  describe('authentication and roles', () => {
    it('answers 401 without a token', async () => {
      expectError(await e2e.send(null, 'get', '/api/invoices'), 401, 'UNAUTHENTICATED');
    });

    it('refuses a counter payment from an Org Manager (payment.recordCounter is Staff’s)', async () => {
      expectError(
        await e2e.send('manager-a', 'post', `/api/invoices/${INVOICE_B}/payments/counter`, COUNTER),
        403,
        'FORBIDDEN',
      );
    });

    it.each(['/api/invoices', '/api/payments'])(
      'refuses %s to an Org Operator, who reads no billing',
      async (path) => {
        expectError(await e2e.send('operator-a', 'get', path), 403, 'FORBIDDEN');
      },
    );

    // api-design 16 and 17 (UC-48): the queue is TrekLink's, and only an Admin decides.
    it('refuses the damage charge queue to an Org Manager', async () => {
      expectError(await e2e.send('manager-a', 'get', '/api/damage-charges'), 403, 'FORBIDDEN');
    });

    it('refuses a damage charge decision from TrekLink Staff (damageCharge.decide is the Admin’s)', async () => {
      const response = await e2e.send(
        'staff-1',
        'post',
        `/api/damage-charges/${MISSING}/decision`,
        {
          decision: 'APPROVED',
          note: 'Confirmed',
        },
      );
      expectError(response, 403, 'FORBIDDEN');
    });

    it('refuses a quote to an Org Operator', async () => {
      const response = await e2e.send('operator-a', 'post', '/api/quotes', {
        planType: 'MONTHLY',
        hardwareVariantId: VARIANT,
        quantity: 5,
      });
      expectError(response, 403, 'FORBIDDEN');
    });
  });

  describe('Validation rows (400 VALIDATION_FAILED)', () => {
    it.each([
      ['an unknown plan', { planType: 'YEARLY' }],
      ['a quantity above 10,000', { quantity: 10_001 }],
      ['a day plan without its length', { planType: 'DAY' }],
      ['a variant that is not a uuid', { hardwareVariantId: 'v3' }],
    ])('api-design 02 refuses %s', async (_, change) => {
      const response = await e2e.send('manager-a', 'post', '/api/quotes', {
        planType: 'MONTHLY',
        hardwareVariantId: VARIANT,
        quantity: 5,
        ...change,
      });
      expectError(response, 400, 'VALIDATION_FAILED');
    });

    it.each([
      '/api/invoices?status=OPEN',
      '/api/invoices?contractId=RC-2026-0001',
      '/api/payments?status=SETTLED',
    ])('api-design 08 and 14 refuse the filter %s', async (path) => {
      expectError(await e2e.send('staff-1', 'get', path), 400, 'VALIDATION_FAILED');
    });

    it.each([
      ['a SePay method at the counter', { method: 'SEPAY' }],
      ['an amount of 0', { amountVnd: 0 }],
      ['an empty reference', { reference: '' }],
      ['a reference over 64 characters', { reference: 'R'.repeat(65) }],
    ])('api-design 13 refuses %s', async (_, change) => {
      const response = await e2e.send(
        'staff-1',
        'post',
        `/api/invoices/${INVOICE_B}/payments/counter`,
        { ...COUNTER, ...change },
      );
      expectError(response, 400, 'VALIDATION_FAILED');
    });

    it('api-design 16 refuses an unknown damage charge status', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/damage-charges?status=OPEN'),
        400,
        'VALIDATION_FAILED',
      );
    });

    it('refuses an invoice id that is not a uuid', async () => {
      expectError(
        await e2e.send('staff-1', 'get', '/api/invoices/INV-2026-000001'),
        400,
        'VALIDATION_FAILED',
      );
    });
  });

  describe('tenant isolation (FR-AUTH-11)', () => {
    it("answers 404 to an Org Manager for another organization's invoice", async () => {
      const response = await e2e.send('manager-a', 'get', `/api/invoices/${INVOICE_B}`);
      expectError(response, 404, 'NOT_FOUND');
      expect(envelope(response).message).toBe('Invoice not found.');
    });

    it("answers 404 to an Org Manager for another organization's balance", async () => {
      const response = await e2e.send('manager-a', 'get', `/api/contracts/${CONTRACT_B}/balance`);
      expectError(response, 404, 'NOT_FOUND');
      expect(envelope(response).message).toBe('Contract not found.');
    });

    it('answers 404 for an invoice that does not exist', async () => {
      expectError(await e2e.send('staff-1', 'get', `/api/invoices/${MISSING}`), 404, 'NOT_FOUND');
    });
  });
});
