import { ContractStatus, PlanType, Prisma } from '@prisma/client';
import { InvoicesService } from '../billing';
import { DevicesService } from '../devices';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ParameterService } from '../platform/parameters/parameter.service';
import { ContractLifecycleService } from './contract-lifecycle.service';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { TermRolloverJob } from './term-rollover.job';

const AT = new Date('2026-11-25T03:00:00.000Z');
const TERM_END = new Date('2026-11-25T02:00:00.000Z');
const TX = {} as Prisma.TransactionClient;

const contract = (overrides: Partial<ContractRow> = {}) =>
  ({
    id: 'c-1',
    organizationId: 'org-1',
    planType: PlanType.MONTHLY,
    hardwareVariantId: 'v-3',
    quantity: 2,
    monthlyUnitPriceVnd: 450_000n,
    holdingFeeRatio: new Prisma.Decimal('0.5'),
    status: ContractStatus.ACTIVE,
    ...overrides,
  }) as ContractRow;

const term = {
  id: 't-1',
  contractId: 'c-1',
  seq: 1,
  startsAt: new Date('2026-10-25T02:00:00Z'),
  endsAt: TERM_END,
  status: 'OPEN',
};

describe('TermRolloverJob (rentals task 3.1)', () => {
  let contracts: Record<string, jest.Mock>;
  let lifecycle: { apply: jest.Mock };
  let invoices: { issueTermInvoice: jest.Mock };
  let job: TermRolloverJob;
  let parameters: { get: jest.Mock };

  beforeEach(() => {
    contracts = {
      dueTerms: jest.fn().mockResolvedValue([term]),
      lockById: jest.fn().mockResolvedValue(contract()),
      closeTerm: jest.fn().mockResolvedValue(true),
      insertTerm: jest
        .fn()
        .mockImplementation((row: object) => Promise.resolve({ id: 't-2', ...row })),
      setReturnDueAt: jest.fn().mockResolvedValue(undefined),
      returnCounts: jest.fn().mockResolvedValue({ total: 2, returned: 0 }),
    };
    lifecycle = { apply: jest.fn().mockResolvedValue(contract()) };
    invoices = { issueTermInvoice: jest.fn().mockResolvedValue({ id: 'inv-2' }) };
    parameters = { get: jest.fn().mockResolvedValue(9) };
    job = new TermRolloverJob(
      contracts as unknown as ContractsRepository,
      lifecycle as unknown as ContractLifecycleService,
      invoices as unknown as InvoicesService,
      {
        variants: jest.fn().mockResolvedValue([{ id: 'v-3', code: 'treklink-v3' }]),
      } as unknown as DevicesService,
      {
        transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      } as unknown as TransactionalEvents,
      parameters as unknown as ParameterService,
    );
  });

  it('renews a monthly ACTIVE contract with the next term and its invoice', async () => {
    await expect(job.run(AT)).resolves.toEqual({ renewed: 1, returnDue: 0, returned: 0 });
    expect(contracts.insertTerm).toHaveBeenCalledWith(
      {
        contractId: 'c-1',
        seq: 2,
        startsAt: TERM_END,
        endsAt: new Date('2026-12-25T02:00:00.000Z'),
      },
      TX,
    );
    expect(invoices.issueTermInvoice).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'c-1', variantCode: 'treklink-v3' }),
      expect.objectContaining({ id: 't-2', seq: 2 }),
      TX,
      AT,
    );
  });

  it('leaves a term ending after the daily cutoff for the next daily batch', async () => {
    const later = { ...term, endsAt: new Date('2026-11-25T03:00:00Z') };
    contracts.dueTerms.mockImplementation((cutoff: Date) =>
      Promise.resolve(later.endsAt <= cutoff ? [later] : []),
    );
    await job.run(new Date('2026-11-25T03:00:00Z'));
    await job.run(new Date('2026-11-26T01:59:59Z'));
    expect(contracts.closeTerm).not.toHaveBeenCalled();
    await job.run(new Date('2026-11-26T02:00:00Z'));
    expect(contracts.closeTerm).toHaveBeenCalledWith('t-1', TX);
  });

  it('reads a changed configured hour on the next run', async () => {
    contracts.dueTerms.mockResolvedValue([]);
    parameters.get.mockResolvedValueOnce(11).mockResolvedValueOnce(9);
    await job.run(AT);
    expect(contracts.dueTerms).toHaveBeenLastCalledWith(new Date('2026-11-24T04:00:00Z'));
    await job.run(AT);
    expect(contracts.dueTerms).toHaveBeenLastCalledWith(new Date('2026-11-25T02:00:00Z'));
    expect(parameters.get).toHaveBeenCalledWith('rentals.termRolloverHourLocal');
  });

  it('moves a contract under notice to RETURN_DUE at the term end', async () => {
    contracts.lockById.mockResolvedValue(contract({ status: ContractStatus.ENDING }));
    await expect(job.run(AT)).resolves.toEqual({ renewed: 0, returnDue: 1, returned: 0 });
    expect(contracts.setReturnDueAt).toHaveBeenCalledWith('c-1', TERM_END, TX);
    expect(lifecycle.apply).toHaveBeenCalledWith(
      'c-1',
      ContractStatus.ENDING,
      ContractStatus.RETURN_DUE,
      'TERM_ENDED',
      null,
      TX,
    );
    expect(contracts.insertTerm).not.toHaveBeenCalled();
  });

  it('takes a day plan whose devices are all back straight on to RETURNED', async () => {
    contracts.lockById.mockResolvedValue(contract({ planType: PlanType.DAY }));
    contracts.returnCounts.mockResolvedValue({ total: 2, returned: 2 });
    await expect(job.run(AT)).resolves.toEqual({ renewed: 0, returnDue: 1, returned: 1 });
    expect(lifecycle.apply).toHaveBeenLastCalledWith(
      'c-1',
      ContractStatus.RETURN_DUE,
      ContractStatus.RETURNED,
      'ALL_DEVICES_BACK',
      null,
      TX,
    );
  });

  it('does nothing on a re-run: the term is already closed', async () => {
    contracts.closeTerm.mockResolvedValue(false);
    await expect(job.run(AT)).resolves.toEqual({ renewed: 0, returnDue: 0, returned: 0 });
    expect(lifecycle.apply).not.toHaveBeenCalled();
  });
});
