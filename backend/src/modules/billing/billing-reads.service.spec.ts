import { validateQuery } from '../../common/pipes/app-validation.pipe';
import { InvoiceQueryDto } from './dto/billing-queries.dto';
import { ConfigService } from '@nestjs/config';
import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService } from './balance.service';
import { BillingReadsService } from './billing-reads.service';
import { toInvoiceDetailView } from './invoices.controller';
import { InvoicesRepository } from './invoices.repository';
import { PaymentsRepository } from './payments.repository';

const NOW = new Date('2026-11-01T00:00:00.000Z');
const STAFF: Caller = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const MANAGER: Caller = { id: 'u-mgr', roles: ['ORG_MANAGER'], organizationId: 'org-1' };

const invoice = (overrides: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  number: 'INV-2026-000001',
  organizationId: 'org-1',
  contractId: 'c-1',
  termId: 't-1',
  kind: InvoiceKind.TERM,
  status: InvoiceStatus.ISSUED,
  totalVnd: 4_500_000n,
  paidVnd: 0n,
  issuedAt: NOW,
  ...overrides,
});

const ENV: Record<string, unknown> = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
  COMPANY_LEGAL_NAME: 'TrekLink Co., Ltd.',
  COMPANY_TAX_CODE: '0312345678',
  COMPANY_ADDRESS: 'Ho Chi Minh City',
  COMPANY_HOTLINE: '1900 1234',
};
const config = { get: (key: string) => ENV[key] } as unknown as ConfigService;
const BUYER = {
  legalName: 'Fansipan Trekking JSC',
  taxCode: '0109876543',
  address: 'Sa Pa, Lao Cai',
};

describe('BillingReadsService (billing task 4.1, api-design 08, 09, 10, 14)', () => {
  let invoices: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;
  let balances: Record<string, jest.Mock>;
  let directory: { describe: jest.Mock; variantsOf: jest.Mock; buyerOf: jest.Mock };

  const service = (withDirectory = true) =>
    new BillingReadsService(
      invoices as unknown as InvoicesRepository,
      payments as unknown as PaymentsRepository,
      balances as unknown as BalanceService,
      config as never,
      withDirectory ? directory : undefined,
    );

  beforeEach(() => {
    invoices = {
      page: jest.fn().mockResolvedValue([[invoice()], 1]),
      detail: jest.fn().mockResolvedValue({ ...invoice(), lines: [] }),
      organizationOfContract: jest.fn().mockResolvedValue('org-1'),
    };
    payments = {
      page: jest.fn().mockResolvedValue([[], 0]),
      ofInvoice: jest.fn().mockResolvedValue([]),
    };
    balances = {
      balanceSummary: jest.fn().mockResolvedValue({
        contractId: 'c-1',
        dueNowVnd: 0n,
        dueLaterVnd: 2_250_000n,
        paidVnd: 2_250_000n,
        settled: false,
      }),
    };
    directory = {
      describe: jest.fn().mockResolvedValue({
        contracts: new Map([['c-1', { code: 'RC-2026-0001', organizationCode: 'ORG-0001' }]]),
        termSeqs: new Map([['t-1', 1]]),
      }),
      variantsOf: jest.fn().mockResolvedValue(new Map()),
      buyerOf: jest.fn().mockResolvedValue(BUYER),
    };
  });

  it('scopes a member to its own organization and a TrekLink account to none', async () => {
    await service().invoicePage({}, MANAGER, NOW);
    expect(invoices.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      0,
      20,
      undefined,
      undefined,
    );
    await service().invoicePage({}, STAFF, NOW);
    expect(invoices.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: undefined }),
      0,
      20,
      undefined,
      undefined,
    );
  });

  it('passes the overdue cut-off only when asked, and pages with the defaults', async () => {
    await service().invoicePage({ overdue: true, pageNumber: 2 }, STAFF, NOW);
    expect(invoices.page).toHaveBeenCalledWith(
      expect.objectContaining({ overdueAt: NOW }),
      20,
      20,
      undefined,
      undefined,
    );
  });

  // W26: the invoice lists sort on the server by one allowed column (api-design 08).
  it('passes the requested sort to the page, ascending by default', async () => {
    const sortOf = () => (invoices.page.mock.calls as unknown[][]).at(-1)?.[4];
    await service().invoicePage({ sort: 'totalVnd', order: 'desc' }, STAFF, NOW);
    expect(sortOf()).toEqual({ field: 'totalVnd', order: 'desc' });
    await service().invoicePage({ sort: 'number' }, STAFF, NOW);
    expect(sortOf()).toEqual({ field: 'number', order: 'asc' });
    await expect(service().invoicePage({ order: 'desc' }, STAFF, NOW)).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
    });
  });

  it('refuses a sort field off the allowlist with 400 VALIDATION_FAILED', async () => {
    await expect(
      validateQuery(InvoiceQueryDto, { sort: 'paidVnd', order: 'asc' }),
    ).resolves.toMatchObject({ sort: 'paidVnd', order: 'asc' });
    await expect(validateQuery(InvoiceQueryDto, { sort: 'kind' })).rejects.toMatchObject({
      errorCode: 'VALIDATION_FAILED',
      status: 400,
    });
  });

  it('labels each invoice with its contract, organization and term from the directory', async () => {
    const page = await service().invoicePage({}, STAFF, NOW);
    expect(page.items[0]).toMatchObject({
      contract: { code: 'RC-2026-0001', organizationCode: 'ORG-0001' },
      termSeq: 1,
    });
    expect(directory.describe).toHaveBeenCalledWith(['c-1'], ['t-1']);
  });

  it('leaves the labels null without a directory provider', async () => {
    const page = await service(false).invoicePage({}, STAFF, NOW);
    expect(page.items[0]).toMatchObject({ contract: null, termSeq: null });
  });

  it("answers 404 for another organization's invoice (REQ-ERR-06)", async () => {
    invoices.detail.mockResolvedValue({ ...invoice({ organizationId: 'org-2' }), lines: [] });
    await expect(service().invoice('inv-1', MANAGER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    await expect(service().invoice('inv-1', STAFF)).resolves.toMatchObject({ payments: [] });
  });

  it('adds the seller from COMPANY_* and the buyer from the directory to the detail (screen 6.1)', async () => {
    const detail = await service().invoice('inv-1', MANAGER);
    expect(detail.seller).toEqual({
      legalName: 'TrekLink Co., Ltd.',
      taxCode: '0312345678',
      address: 'Ho Chi Minh City',
      hotline: '1900 1234',
    });
    expect(detail.buyer).toEqual(BUYER);
    expect(directory.buyerOf).toHaveBeenCalledWith('org-1');
  });

  it('leaves the buyer null without a directory provider, and the view reads it as nulls', async () => {
    const detail = await service(false).invoice('inv-1', STAFF);
    expect(detail.buyer).toBeNull();
    expect(toInvoiceDetailView(detail).organization).toEqual({
      id: 'org-1',
      code: null,
      legalName: null,
      taxCode: null,
      address: null,
    });
  });

  it('puts the buyer on `organization` and the seller beside it in the detail view (api-design 09)', async () => {
    const view = toInvoiceDetailView(await service().invoice('inv-1', MANAGER));
    expect(view.organization).toEqual({ id: 'org-1', code: 'ORG-0001', ...BUYER });
    expect(view.seller.legalName).toBe('TrekLink Co., Ltd.');
  });

  it("answers 404 for another organization's contract balance, zeros before any invoice", async () => {
    invoices.organizationOfContract.mockResolvedValue('org-2');
    await expect(service().balance('c-1', MANAGER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    invoices.organizationOfContract.mockResolvedValue(null);
    await expect(service().balance('c-1', MANAGER)).resolves.toMatchObject({ contractId: 'c-1' });
  });
});
