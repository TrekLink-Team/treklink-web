import { ConfigService } from '@nestjs/config';
import { InvoiceKind, InvoiceStatus } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { BalanceService } from './balance.service';
import { BillingReadsService } from './billing-reads.service';
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

const config = {
  get: (key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100),
} as unknown as ConfigService;

describe('BillingReadsService (billing task 4.1, api-design 08, 09, 10, 14)', () => {
  let invoices: Record<string, jest.Mock>;
  let payments: Record<string, jest.Mock>;
  let balances: Record<string, jest.Mock>;
  let directory: { describe: jest.Mock; variantsOf: jest.Mock };

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
    };
  });

  it('scopes a member to its own organization and a TrekLink account to none', async () => {
    await service().invoicePage({}, MANAGER, NOW);
    expect(invoices.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: 'org-1' }),
      0,
      20,
    );
    await service().invoicePage({}, STAFF, NOW);
    expect(invoices.page).toHaveBeenLastCalledWith(
      expect.objectContaining({ organizationId: undefined }),
      0,
      20,
    );
  });

  it('passes the overdue cut-off only when asked, and pages with the defaults', async () => {
    await service().invoicePage({ overdue: true, pageNumber: 2 }, STAFF, NOW);
    expect(invoices.page).toHaveBeenCalledWith(expect.objectContaining({ overdueAt: NOW }), 20, 20);
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

  it("answers 404 for another organization's contract balance, zeros before any invoice", async () => {
    invoices.organizationOfContract.mockResolvedValue('org-2');
    await expect(service().balance('c-1', MANAGER)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
    invoices.organizationOfContract.mockResolvedValue(null);
    await expect(service().balance('c-1', MANAGER)).resolves.toMatchObject({ contractId: 'c-1' });
  });
});
