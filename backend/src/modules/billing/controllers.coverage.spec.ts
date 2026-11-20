import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA, HTTP_CODE_METADATA } from '@nestjs/common/constants';
import { InvoiceKind, InvoiceStatus, PaymentMethod, PaymentStatus } from '@prisma/client';
import {
  Caller,
  CHECK_POLICIES_KEY,
  IS_PUBLIC_KEY,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { BillingReadsService } from './billing-reads.service';
import { InvoicesController } from './invoices.controller';
import { PaymentsService } from './payments.service';
import { RELEASE_ADJUSTMENT_PREFIX } from './release-adjustments';
import { SepayController } from './sepay.controller';
import { SepayWebhookGuard } from './sepay-webhook.guard';
import { SepayService } from './sepay.service';
import { ServiceCreditService } from './service-credit.service';
import { ServiceCreditsController } from './service-credits.controller';
import { ServiceCreditRow } from './service-credits.repository';

const AT = new Date('2026-11-02T03:00:00Z');
const MANAGER: Caller = { id: 'u-1', roles: ['ORG_MANAGER'], organizationId: 'o-1' };
const STAFF: Caller = { id: 's-1', roles: ['STAFF'], organizationId: null };
const ROW = {
  id: 'i-1',
  number: 'INV-2026-000001',
  organizationId: 'o-1',
  contractId: 'c-1',
  termId: 't-1',
  kind: InvoiceKind.TERM,
  status: InvoiceStatus.ISSUED,
  totalVnd: 80n,
  paidVnd: 0n,
  issuedAt: AT,
  refundedVnd: null,
  refundedAt: null,
  refundedById: null,
  refundNote: null,
};
const PAYMENT = {
  id: 'p-1',
  reference: 'TL7K2Q9M4D',
  invoiceId: 'i-1',
  contractId: 'c-1',
  organizationId: 'o-1',
  amountVnd: 80n,
  method: PaymentMethod.SEPAY,
  status: PaymentStatus.PENDING,
  isSandbox: true,
  expiresAt: AT,
  confirmedAt: null,
};
const PAGE = { totalCount: 1, pageNumber: 1, pageSize: 20, totalPages: 1 };
const policies = (prototype: object, method: string, action: string, subject: string) => {
  const handler = Object.getOwnPropertyDescriptor(prototype, method)?.value as object;
  const checks = Reflect.getMetadata(CHECK_POLICIES_KEY, handler) as PolicyHandler[];
  expect(checks).toHaveLength(1);
  const can = jest.fn().mockReturnValue(false);
  expect(checks[0]({ can })).toBe(false);
  expect(can).toHaveBeenCalledWith(action, subject);
  can.mockReturnValue(true);
  expect(checks[0]({ can })).toBe(true);
};

describe('Invoice controller lifecycle coverage', () => {
  const labelled = {
    row: ROW,
    contract: { code: 'C-1', organizationCode: 'ORG-1' },
    termSeq: 1,
    creditDueVnd: null,
  };
  const reads = {
    invoicePage: jest.fn(),
    invoice: jest.fn(),
    balance: jest.fn(),
    paymentPage: jest.fn(),
  };
  const payments = { recordCounter: jest.fn() };
  const controller = new InvoicesController(
    reads as unknown as BillingReadsService,
    payments as unknown as PaymentsService,
  );
  beforeEach(() => jest.resetAllMocks());
  it('returns numeric list totals and contract labels', async () => {
    reads.invoicePage.mockResolvedValue({
      ...PAGE,
      items: [labelled],
      totals: { invoicedVnd: 80n, paidVnd: 10n, outstandingVnd: 70n },
    });
    const query = { status: InvoiceStatus.ISSUED };
    const result = await controller.list(query, MANAGER);
    expect(reads.invoicePage).toHaveBeenCalledWith(query, MANAGER);
    expect(result).toMatchObject({
      ...PAGE,
      totals: { invoicedVnd: 80, paidVnd: 10, outstandingVnd: 70 },
      items: [
        {
          totalVnd: 80,
          term: { seq: 1 },
          contract: { id: 'c-1', code: 'C-1' },
          organization: { id: 'o-1', code: 'ORG-1' },
        },
      ],
    });
  });
  it.each([null, { legalName: 'Buyer', taxCode: '123', address: 'Address' }])(
    'renders invoice lines, release adjustments and buyer %j',
    async (buyer) => {
      const fee = {
        seq: 1,
        type: 'HOLDING_FEE',
        description: 'Holding fee',
        quantity: 1,
        unitVnd: 100n,
        amountVnd: 100n,
        dueAt: AT,
        paidVnd: 0n,
      };
      const adjustment = {
        ...fee,
        seq: 2,
        type: 'ADJUSTMENT',
        description: `${RELEASE_ADJUSTMENT_PREFIX}holding fee`,
        amountVnd: -20n,
        unitVnd: -20n,
      };
      reads.invoice.mockResolvedValue({
        ...labelled,
        row: { ...ROW, lines: [fee, adjustment] },
        buyer,
        seller: { legalName: 'TrekLink' },
        payments: [PAYMENT],
      });
      const result = await controller.detail('i-1', MANAGER);
      expect(reads.invoice).toHaveBeenCalledWith('i-1', MANAGER);
      expect(result.organization).toMatchObject({
        legalName: buyer?.legalName ?? null,
        taxCode: buyer?.taxCode ?? null,
        address: buyer?.address ?? null,
      });
      expect(result.lines).toEqual([
        { ...fee, amountVnd: 100, unitVnd: 100, paidVnd: 0, payableAmountVnd: 80 },
        { ...adjustment, amountVnd: -20, unitVnd: -20, paidVnd: 0 },
      ]);
      expect(result.payments[0]).toMatchObject({ amountVnd: 80, status: 'PENDING' });
    },
  );
  it('renders a balance with pending damage and refundable money', async () => {
    reads.balance.mockResolvedValue({
      contractId: 'c-1',
      dueNowVnd: 10n,
      dueLaterVnd: 20n,
      paidVnd: 30n,
      owedToOrganizationVnd: 40n,
      settled: false,
      pendingDamageCharges: [
        { id: 'dc-1', deviceId: 'd-1', damageCodes: ['STRAP'], amountVnd: 50n, createdAt: AT },
      ],
    });
    expect(await controller.balance('c-1', STAFF)).toEqual({
      contractId: 'c-1',
      dueNowVnd: 10,
      dueLaterVnd: 20,
      paidVnd: 30,
      owedToOrganizationVnd: 40,
      settled: false,
      pendingDamageCharges: [
        { id: 'dc-1', deviceId: 'd-1', damageCodes: ['STRAP'], amountVnd: 50, createdAt: AT },
      ],
    });
    expect(reads.balance).toHaveBeenCalledWith('c-1', STAFF);
  });
  it('trims counter references, converts input to bigint and serializes payment pages', async () => {
    payments.recordCounter.mockResolvedValue(PAYMENT);
    expect(
      await controller.recordCounter(
        'i-1',
        { method: 'CASH', amountVnd: 80, reference: ' R-42 ' },
        STAFF,
      ),
    ).toMatchObject({ id: 'p-1', amountVnd: 80 });
    expect(payments.recordCounter).toHaveBeenCalledWith(
      'i-1',
      { method: 'CASH', amountVnd: 80n, reference: 'R-42' },
      STAFF,
    );
    reads.paymentPage.mockResolvedValue({ ...PAGE, items: [PAYMENT] });
    expect(await controller.listPayments({}, MANAGER)).toMatchObject({
      ...PAGE,
      items: [{ amountVnd: 80 }],
    });
    expect(reads.paymentPage).toHaveBeenCalledWith({}, MANAGER);
  });
  it.each([
    ['list', 'read', 'Invoice'],
    ['detail', 'read', 'Invoice'],
    ['balance', 'read', 'Invoice'],
    ['recordCounter', 'recordCounter', 'Invoice'],
    ['listPayments', 'read', 'Payment'],
  ])('enforces %s policy', (method, action, subject) =>
    policies(InvoicesController.prototype, method, action, subject),
  );
});

describe('SePay controller and verification guard coverage', () => {
  const sepay = {
    request: jest.fn(),
    vietQr: jest.fn(),
    find: jest.fn(),
    handleWebhook: jest.fn(),
    assertWebhookKey: jest.fn(),
  };
  const controller = new SepayController(sepay as unknown as SepayService);
  beforeEach(() => jest.resetAllMocks());
  it('forwards the requested invoice line and includes the QR', async () => {
    sepay.request.mockResolvedValue(PAYMENT);
    sepay.vietQr.mockResolvedValue({ imageUrl: 'https://qr.sepay.vn/img' });
    expect(await controller.request('i-1', { lineSeq: 2 }, MANAGER)).toMatchObject({
      amountVnd: 80,
      vietQr: { imageUrl: 'https://qr.sepay.vn/img' },
    });
    expect(sepay.request).toHaveBeenCalledWith('i-1', 2, MANAGER);
    expect(sepay.vietQr).toHaveBeenCalledWith(PAYMENT);
  });
  it('includes money received separately in polling responses', async () => {
    sepay.find.mockResolvedValue({
      ...PAYMENT,
      receivedLater: [{ amountVnd: 50n, confirmedAt: AT }],
    });
    sepay.vietQr.mockResolvedValue(null);
    expect(await controller.find('p-1', MANAGER)).toMatchObject({
      amountVnd: 80,
      vietQr: null,
      receivedLater: [{ amountVnd: 50, confirmedAt: AT }],
    });
    expect(sepay.find).toHaveBeenCalledWith('p-1', MANAGER);
  });
  it('returns SePay success after processing and propagates processing failures', async () => {
    const hook = { id: 42, transferAmount: 80 };
    await expect(controller.webhook('Apikey key', hook)).resolves.toEqual({ success: true });
    expect(sepay.handleWebhook).toHaveBeenCalledWith('Apikey key', hook);
    sepay.handleWebhook.mockRejectedValueOnce(new Error('ledger unavailable'));
    await expect(controller.webhook(undefined, hook)).rejects.toThrow('ledger unavailable');
    const handler = Object.getOwnPropertyDescriptor(SepayController.prototype, 'webhook')
      ?.value as object;
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([SepayWebhookGuard]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
    expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(200);
  });
  it.each([
    ['request', 'payOnline', 'Invoice'],
    ['find', 'read', 'Payment'],
  ])('enforces %s policy', (method, action, subject) =>
    policies(SepayController.prototype, method, action, subject),
  );
  it.each([undefined, 'Apikey key'])(
    'verifies authorization before admitting the webhook: %s',
    (authorization) => {
      const context = {
        switchToHttp: () => ({ getRequest: () => ({ headers: { authorization } }) }),
      } as unknown as ExecutionContext;
      const guard = new SepayWebhookGuard(sepay as unknown as SepayService);
      expect(guard.canActivate(context)).toBe(true);
      expect(sepay.assertWebhookKey).toHaveBeenCalledWith(authorization);
      sepay.assertWebhookKey.mockImplementationOnce(() => {
        throw new Error('unauthenticated');
      });
      expect(() => guard.canActivate(context)).toThrow('unauthenticated');
    },
  );
});

describe('Service credit controller refund and policies coverage', () => {
  const credits = {
    request: jest.fn(),
    list: jest.fn(),
    decide: jest.fn(),
    refund: jest.fn(),
    recordRefund: jest.fn(),
  };
  const controller = new ServiceCreditsController(credits as unknown as ServiceCreditService);
  const credit = {
    id: 'sc-1',
    contractId: 'c-1',
    computedVnd: 100n,
    decidedVnd: null,
    appliedVnd: 0n,
  } as ServiceCreditRow;
  beforeEach(() => {
    jest.resetAllMocks();
    credits.request.mockResolvedValue(credit);
    credits.decide.mockResolvedValue(credit);
    credits.recordRefund.mockResolvedValue({ ...credit, decidedVnd: 80n });
  });
  it('delegates credit requests, decisions and refunds and converts nullable amounts', async () => {
    const request = {
      contractDeviceId: 'cd-1',
      cause: 'BATTERY_FAULT' as const,
      faultInspectionId: 'f-1',
    };
    expect(await controller.request('c-1', request, STAFF)).toMatchObject({
      computedVnd: 100,
      decidedVnd: null,
      appliedVnd: 0,
      assetTag: null,
      release: null,
    });
    expect(credits.request).toHaveBeenCalledWith('c-1', request, STAFF);
    const decision = { decision: 'APPROVE' as const, expectedVersion: 1 };
    await controller.decide('sc-1', decision, STAFF);
    expect(credits.decide).toHaveBeenCalledWith('sc-1', decision, STAFF);
    expect(await controller.refund('sc-1', { reference: 'R-42' }, STAFF)).toMatchObject({
      decidedVnd: 80,
    });
    expect(credits.recordRefund).toHaveBeenCalledWith('sc-1', 'R-42', STAFF);
  });
  it.each([MANAGER, STAFF])('scopes both credit lists for caller $id', async (caller) => {
    const release = { reason: 'Released', releasedAt: AT };
    credits.list.mockResolvedValue({ ...PAGE, items: [{ ...credit, assetTag: 'TL-1', release }] });
    const query = { status: 'REQUESTED' as const, contractId: 'c-filter' };
    expect(await controller.ofContract('c-route', query, caller)).toMatchObject({
      ...PAGE,
      items: [{ computedVnd: 100, assetTag: 'TL-1', release }],
    });
    expect(credits.list).toHaveBeenCalledWith(
      {
        contractId: 'c-route',
        status: 'REQUESTED',
        organizationId: caller.organizationId ?? undefined,
      },
      query,
    );
    await controller.list(query, caller);
    expect(credits.list).toHaveBeenLastCalledWith(
      {
        contractId: 'c-filter',
        status: 'REQUESTED',
        organizationId: caller.organizationId ?? undefined,
      },
      query,
    );
  });
  it.each([
    ['request', 'request'],
    ['ofContract', 'read'],
    ['list', 'read'],
    ['decide', 'decide'],
    ['refund', 'refund'],
  ])('enforces %s policy', (method, action) =>
    policies(ServiceCreditsController.prototype, method, action, 'ServiceCredit'),
  );
});
