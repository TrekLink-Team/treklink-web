import { Logger } from '@nestjs/common';
import { ContractStatus, GroupExit, PlanType, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { InvoicesService } from '../billing';
import { OrganizationsService } from '../organizations';
import { ContractDecisionsService } from './contract-decisions.service';
import { ContractRow, ContractsRepository } from './contracts.repository';
import { ContractsService } from './contracts.service';
import {
  ContractQueryDto,
  EndNowDto,
  HandoverPreviewQueryDto,
  ReleaseUnitDto,
} from './dto/contract-decision.dto';
import { CreateGroupDto, UpdateGroupDto } from './dto/groups.dto';
import { FaultReportsRepository } from './fault-reports.repository';
import { openFirstTerm } from './first-invoice';
import { GroupsRepository } from './groups.repository';
import { RentalsCreditBasis } from './providers/credit-basis.provider';
import { RentalsDeviceContracts } from './providers/device-contracts.provider';
import { RequestHoldExpiryJob } from './request-hold-expiry.job';

const AT = new Date('2026-11-20T03:00:00Z');
const TX = {} as Prisma.TransactionClient;

type Calls = [string, unknown][];

// A Prisma stand-in that records delegate calls as [model.operation, args] and the tagged raw queries as
// [$executeRaw or $queryRaw, { sql, values }]. `answers` replaces the default answer of one call.
const recorder = (answers: Record<string, unknown> = {}) => {
  const calls: Calls = [];
  const defaults: Record<string, unknown> = {
    findMany: [],
    findFirst: null,
    updateMany: { count: 1 },
  };
  const client = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === '$executeRaw' || name === '$queryRaw') {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            calls.push([name, { sql: strings.join('?'), values }]);
            return Promise.resolve(name in answers ? answers[name] : []);
          };
        }
        return new Proxy(
          {},
          {
            get: (_inner, operation: string) => (args: unknown) => {
              const key = `${name}.${operation}`;
              calls.push([key, args]);
              return Promise.resolve(
                key in answers ? answers[key] : operation in defaults ? defaults[operation] : {},
              );
            },
          },
        );
      },
    },
  );
  const prisma = client as unknown as PrismaService & Prisma.TransactionClient;
  return { calls, prisma };
};

const argsOf = (calls: Calls, index: number) => calls[index][1] as Record<string, unknown>;

describe('GroupsRepository', () => {
  const setup = (answers: Record<string, unknown> = {}) => {
    const { calls, prisma } = recorder(answers);
    return { calls, prisma, repository: new GroupsRepository(prisma) };
  };

  it('lists the live groups of an organization by name', async () => {
    const { repository, calls } = setup();
    await repository.list('org-1');
    expect(calls[0][0]).toBe('group.findMany');
    expect(argsOf(calls, 0).where).toEqual({ organizationId: 'org-1', removedAt: null });
    expect(argsOf(calls, 0).orderBy).toEqual([{ name: 'asc' }, { id: 'asc' }]);
  });

  it('reads the topology through the default client or the caller transaction', async () => {
    const { repository, calls, prisma } = setup();
    await repository.topology('org-1');
    await repository.topology('org-1', prisma);
    for (const index of [0, 1]) {
      expect(calls[index][0]).toBe('group.findMany');
      expect(argsOf(calls, index)).toEqual({
        where: { organizationId: 'org-1', removedAt: null },
        select: { id: true, parentId: true },
      });
    }
  });

  it('takes the advisory lock of the organization tree', async () => {
    const { repository, calls, prisma } = setup();
    await repository.lockTree('org-1', prisma);
    expect(calls[0][0]).toBe('$executeRaw');
    expect((calls[0][1] as { values: unknown[] }).values).toEqual(['rentals:group-tree:org-1']);
  });

  it('locks no rows for an empty list of groups', async () => {
    const { repository, calls, prisma } = setup();
    await repository.lockGroups('org-1', [], prisma);
    expect(calls).toEqual([]);
  });

  it('locks the live groups of the organization in id order', async () => {
    const { repository, calls, prisma } = setup();
    await repository.lockGroups('org-1', ['g-2', 'g-1'], prisma);
    expect(calls).toHaveLength(1);
    const { sql, values } = calls[0][1] as { sql: string; values: unknown[] };
    expect(calls[0][0]).toBe('$queryRaw');
    expect(sql).toContain('FOR UPDATE');
    expect(sql).toContain('ORDER BY "id"');
    expect(values[0]).toBe('org-1');
    expect((values[1] as Prisma.Sql).values).toEqual(['g-2', 'g-1']);
  });

  it('finds, creates and updates a group inside the organization', async () => {
    const { repository, calls, prisma } = setup();
    await repository.find('org-1', 'g-1', prisma);
    await repository.create({ name: 'North', organizationId: 'org-1', createdById: 'u-1' }, prisma);
    await repository.update('org-1', 'g-1', { name: 'South' }, prisma);
    expect(calls[0][0]).toBe('group.findFirst');
    expect(argsOf(calls, 0).where).toEqual({
      organizationId: 'org-1',
      id: 'g-1',
      removedAt: null,
    });
    expect(calls[1][0]).toBe('group.create');
    expect(argsOf(calls, 1).data).toEqual({
      name: 'North',
      organizationId: 'org-1',
      createdById: 'u-1',
    });
    expect(calls[2][0]).toBe('group.update');
    expect(argsOf(calls, 2).where).toEqual({ organizationId: 'org-1', id: 'g-1' });
    expect(argsOf(calls, 2).data).toEqual({ name: 'South' });
  });

  it('removes groups: locks the assigned devices in order, ends the assignments, marks the groups', async () => {
    const { repository, calls, prisma } = setup({
      'groupAssignment.findMany': [{ deviceId: 'd-2' }, { deviceId: 'd-1' }],
      'groupAssignment.updateManyAndReturn': [{ deviceId: 'd-1' }, { deviceId: 'd-2' }],
    });
    await expect(repository.remove('org-1', ['g-1', 'g-2'], AT, prisma)).resolves.toEqual([
      'd-1',
      'd-2',
    ]);
    expect(calls.map(([name]) => name)).toEqual([
      'groupAssignment.findMany',
      '$executeRaw',
      '$executeRaw',
      'groupAssignment.updateManyAndReturn',
      'group.updateMany',
    ]);
    expect((calls[1][1] as { values: unknown[] }).values).toEqual(['rentals:group-device:d-1']);
    expect((calls[2][1] as { values: unknown[] }).values).toEqual(['rentals:group-device:d-2']);
    expect(argsOf(calls, 3)).toEqual({
      where: { groupId: { in: ['g-1', 'g-2'] }, endedAt: null },
      data: { endedAt: AT, endedReason: GroupExit.GROUP_REMOVED },
      select: { deviceId: true },
    });
    expect(argsOf(calls, 4)).toEqual({
      where: { organizationId: 'org-1', id: { in: ['g-1', 'g-2'] }, removedAt: null },
      data: { removedAt: AT },
    });
  });

  it('locks each device once, in id order', async () => {
    const { repository, calls, prisma } = setup();
    await repository.lockDevices(['b', 'a', 'b'], prisma);
    expect(calls.map(([name]) => name)).toEqual(['$executeRaw', '$executeRaw']);
    expect((calls[0][1] as { values: unknown[] }).values).toEqual(['rentals:group-device:a']);
    expect((calls[1][1] as { values: unknown[] }).values).toEqual(['rentals:group-device:b']);
  });

  it('reads the open assignments of devices, ends assignments and opens one', async () => {
    const { repository, calls, prisma } = setup();
    await repository.openAssignments(['d-1', 'd-2'], prisma);
    await repository.endAssignments(['a-1'], GroupExit.MOVED, AT, prisma);
    await repository.openAssignment(
      { groupId: 'g-1', deviceId: 'd-1', contractDeviceId: 'cd-1', assignedById: 'u-1' },
      AT,
      prisma,
    );
    expect(calls[0][0]).toBe('groupAssignment.findMany');
    expect(argsOf(calls, 0).where).toEqual({ deviceId: { in: ['d-1', 'd-2'] }, endedAt: null });
    expect(argsOf(calls, 1)).toEqual({
      where: { id: { in: ['a-1'] }, endedAt: null },
      data: { endedAt: AT, endedReason: GroupExit.MOVED },
    });
    expect(calls[2][0]).toBe('groupAssignment.create');
    expect(argsOf(calls, 2).data).toEqual({
      groupId: 'g-1',
      deviceId: 'd-1',
      contractDeviceId: 'cd-1',
      assignedById: 'u-1',
      assignedAt: AT,
    });
  });
});

describe('FaultReportsRepository', () => {
  const setup = (answers: Record<string, unknown> = {}) => {
    const { calls, prisma } = recorder(answers);
    return { calls, prisma, repository: new FaultReportsRepository(prisma) };
  };

  it('locks the contract of the organization and says whether it exists', async () => {
    const found = setup({ $queryRaw: [{ id: 'c-1' }] });
    await expect(found.repository.lockOwnContract('c-1', 'org-1', found.prisma)).resolves.toBe(
      true,
    );
    const { sql, values } = found.calls[0][1] as { sql: string; values: unknown[] };
    expect(sql).toContain('FOR NO KEY UPDATE');
    expect(values).toEqual(['c-1', 'org-1']);
    const missing = setup({ $queryRaw: [] });
    await expect(missing.repository.lockOwnContract('c-1', 'org-2', missing.prisma)).resolves.toBe(
      false,
    );
  });

  it('reads the latest custody row of a device on the contract', async () => {
    const { repository, calls, prisma } = setup();
    await repository.latestCustody('c-1', 'd-1', prisma);
    expect(calls[0][0]).toBe('contractDevice.findFirst');
    expect(argsOf(calls, 0).where).toEqual({ contractId: 'c-1', deviceId: 'd-1' });
    expect(argsOf(calls, 0).orderBy).toEqual([{ reservedAt: 'desc' }, { id: 'desc' }]);
  });

  it('inserts a report and reads the time of its source', async () => {
    const { repository, calls, prisma } = setup();
    const data = { contractId: 'c-1' } as Prisma.DeviceFaultReportUncheckedCreateInput;
    await repository.insert(data, prisma);
    await repository.sourceOf('r-1', 'c-1', 'cd-1', prisma);
    expect(calls[0]).toEqual(['deviceFaultReport.create', { data }]);
    expect(calls[1][0]).toBe('deviceFaultReport.findFirst');
    expect(argsOf(calls, 1).where).toEqual({
      id: 'r-1',
      contractId: 'c-1',
      contractDeviceId: 'cd-1',
    });
  });

  it('lists the reports of a contract for Staff without an organization filter', async () => {
    const reports = [{ id: 'r-1' }];
    const { repository, calls } = setup({
      'rentalContract.findFirst': { deviceFaultReports: reports },
    });
    await expect(repository.ofContract('c-1', null)).resolves.toBe(reports);
    expect(argsOf(calls, 0).where).toEqual({ id: 'c-1' });
    const select = argsOf(calls, 0).select as { deviceFaultReports: { orderBy: unknown } };
    expect(select.deviceFaultReports.orderBy).toEqual([{ reportedAt: 'desc' }, { id: 'desc' }]);
  });

  it('limits the list to the organization of a member and answers null for another contract', async () => {
    const { repository, calls } = setup();
    await expect(repository.ofContract('c-1', 'org-1')).resolves.toBeNull();
    expect(argsOf(calls, 0).where).toEqual({ id: 'c-1', organizationId: 'org-1' });
  });
});

describe('RentalsCreditBasis', () => {
  const found = (overrides: Record<string, unknown> = {}) => ({
    contract: {
      id: 'c-1',
      organizationId: 'org-1',
      status: ContractStatus.ACTIVE,
      planType: PlanType.MONTHLY,
      monthlyUnitPriceVnd: 450_000n,
      dayPremium: null,
      dayPlanDays: null,
      noticeGivenAt: null,
      terms: [
        { seq: 1, startsAt: AT, endsAt: AT, invoice: { id: 'inv-1' } },
        { seq: 2, startsAt: AT, endsAt: AT, invoice: null },
      ],
      ...overrides,
    },
    unit: {
      id: 'cd-1',
      deviceId: 'd-1',
      handedOverAt: AT,
      checkedInAt: null,
      lostAt: null,
      replacedBy: null,
    },
  });

  const setup = (contractsPart: object, faultsPart: object = {}) =>
    new RentalsCreditBasis(
      contractsPart as ContractsRepository,
      faultsPart as FaultReportsRepository,
    );

  it('maps the unit releases by id', async () => {
    const contracts = {
      releaseNotes: jest
        .fn()
        .mockResolvedValue([{ id: 'ur-1', reason: 'Swollen', releasedAt: AT }]),
    };
    await expect(setup(contracts).releaseNotes(['ur-1'])).resolves.toEqual(
      new Map([['ur-1', { reason: 'Swollen', releasedAt: AT }]]),
    );
    expect(contracts.releaseNotes).toHaveBeenCalledWith(['ur-1']);
  });

  it('reads the source of a fault report through the faults repository', async () => {
    const faults = { sourceOf: jest.fn().mockResolvedValue({ reportedAt: AT }) };
    await expect(setup({}, faults).faultReportSource('r-1', 'c-1', 'cd-1', TX)).resolves.toEqual({
      reportedAt: AT,
    });
    expect(faults.sourceOf).toHaveBeenCalledWith('r-1', 'c-1', 'cd-1', TX);
  });

  it('answers null when the contract or the unit is unknown', async () => {
    const contracts = { creditBasis: jest.fn().mockResolvedValue(null) };
    await expect(setup(contracts).basisOf('c-1', 'cd-1', TX)).resolves.toBeNull();
    expect(contracts.creditBasis).toHaveBeenCalledWith('c-1', 'cd-1', TX);
  });

  it('flags each term as invoiced or not and keeps a monthly plan monthly', async () => {
    const contracts = { creditBasis: jest.fn().mockResolvedValue(found()) };
    const basis = await setup(contracts).basisOf('c-1', 'cd-1', TX);
    expect(basis?.contract.planType).toBe('MONTHLY');
    expect(basis?.contract.terms.map((term) => term.invoiced)).toEqual([true, false]);
    expect(basis?.unit.replacementHandedOverAt).toBeNull();
  });

  it('reads a day plan as DAY and the time the replacement was handed over', async () => {
    const replacedAt = new Date('2026-11-21T03:00:00Z');
    const withReplacement = found({ planType: PlanType.DAY });
    withReplacement.unit.replacedBy = { handedOverAt: replacedAt } as never;
    const contracts = { creditBasis: jest.fn().mockResolvedValue(withReplacement) };
    const basis = await setup(contracts).basisOf('c-1', 'cd-1', TX);
    expect(basis?.contract.planType).toBe('DAY');
    expect(basis?.unit).toMatchObject({
      contractDeviceId: 'cd-1',
      replacementHandedOverAt: replacedAt,
    });
  });
});

describe('RentalsDeviceContracts', () => {
  const row = (deviceId: string, organizationId: string) => ({
    deviceId,
    contract: { id: `c-${deviceId}`, code: `RC-${deviceId}`, status: 'ACTIVE', organizationId },
  });

  it('reads nothing for no devices', async () => {
    const contracts = { liveContractsOfDevices: jest.fn() };
    const provider = new RentalsDeviceContracts(
      contracts as unknown as ContractsRepository,
      {} as OrganizationsService,
    );
    await expect(provider.liveContractsOf([])).resolves.toEqual([]);
    expect(contracts.liveContractsOfDevices).not.toHaveBeenCalled();
  });

  it('labels each live contract with its organization code, or null when it has none', async () => {
    const contracts = {
      liveContractsOfDevices: jest
        .fn()
        .mockResolvedValue([row('d-1', 'org-1'), row('d-2', 'org-9')]),
    };
    const organizations = {
      labelsOf: jest.fn().mockResolvedValue(new Map([['org-1', { code: 'ORG-0001' }]])),
    };
    const provider = new RentalsDeviceContracts(
      contracts as unknown as ContractsRepository,
      organizations as unknown as OrganizationsService,
    );
    await expect(provider.liveContractsOf(['d-1', 'd-2'], TX)).resolves.toEqual([
      {
        deviceId: 'd-1',
        contractId: 'c-d-1',
        code: 'RC-d-1',
        status: 'ACTIVE',
        organizationId: 'org-1',
        organizationCode: 'ORG-0001',
      },
      {
        deviceId: 'd-2',
        contractId: 'c-d-2',
        code: 'RC-d-2',
        status: 'ACTIVE',
        organizationId: 'org-9',
        organizationCode: null,
      },
    ]);
    expect(contracts.liveContractsOfDevices).toHaveBeenCalledWith(['d-1', 'd-2'], TX);
    expect(organizations.labelsOf).toHaveBeenCalledWith(['org-1', 'org-9'], TX);
  });
});

describe('openFirstTerm', () => {
  const contract = (overrides: Partial<ContractRow> = {}): ContractRow => ({
    id: 'c-1',
    code: 'RC-2026-0001',
    organizationId: 'org-1',
    planType: PlanType.MONTHLY,
    dayPlanDays: null,
    hardwareVariantId: 'v-3',
    quantity: 2,
    requestedStartDate: new Date('2026-11-12T00:00:00.000Z'),
    monthlyUnitPriceVnd: 450_000n,
    dayPremium: null,
    holdingFeeRatio: new Prisma.Decimal('0.5'),
    status: ContractStatus.REQUESTED,
    statusChangedAt: AT,
    handedOverAt: null,
    endsAt: null,
    noticeGivenAt: null,
    returnDueAt: null,
    version: 1,
    ...overrides,
  });

  const setup = () => {
    const stored = {
      id: 't-1',
      seq: 1,
      startsAt: new Date('2026-11-12T02:00:00.000Z'),
      endsAt: new Date('2026-12-12T02:00:00.000Z'),
    };
    const contracts = { insertTerm: jest.fn().mockResolvedValue(stored) };
    const invoices = {
      issueDayPlanInvoice: jest.fn().mockResolvedValue(undefined),
      issueTermInvoice: jest.fn().mockResolvedValue(undefined),
    };
    return { stored, contracts, invoices };
  };

  const open = (parts: ReturnType<typeof setup>, row: ContractRow, depositDueBy?: Date | null) =>
    openFirstTerm(
      parts.contracts as unknown as ContractsRepository,
      parts.invoices as unknown as InvoicesService,
      row,
      'treklink-v3',
      TX,
      AT,
      depositDueBy,
    );

  it('issues the term invoice of a monthly plan with the holding fee ratio', async () => {
    const parts = setup();
    const term = await open(parts, contract());
    expect(term).toEqual(parts.stored);
    expect(parts.invoices.issueDayPlanInvoice).not.toHaveBeenCalled();
    const call = parts.invoices.issueTermInvoice.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      id: 'c-1',
      organizationId: 'org-1',
      quantity: 2,
      variantCode: 'treklink-v3',
      depositDueBy: null,
    });
    expect((call[0] as { holdingFeeRatio: Prisma.Decimal }).holdingFeeRatio.toString()).toBe('0.5');
    expect(call[1]).toBe(parts.stored);
    expect(call[2]).toBe(TX);
    expect(call[3]).toBe(AT);
  });

  it('passes the deposit due time of a request through to the invoice', async () => {
    const parts = setup();
    const dueBy = new Date('2026-11-13T03:00:00Z');
    await open(parts, contract(), dueBy);
    expect((parts.invoices.issueTermInvoice.mock.calls[0] as unknown[])[0]).toMatchObject({
      depositDueBy: dueBy,
    });
  });

  it('issues the day plan invoice with the premium and the days of the contract', async () => {
    const parts = setup();
    await open(
      parts,
      contract({
        planType: PlanType.DAY,
        dayPlanDays: 3,
        dayPremium: new Prisma.Decimal('1.5'),
      }),
    );
    expect(parts.invoices.issueTermInvoice).not.toHaveBeenCalled();
    const call = parts.invoices.issueDayPlanInvoice.mock.calls[0] as unknown[];
    const input = call[0] as { dayPremium: Prisma.Decimal; dayPlanDays: number };
    expect(input.dayPremium.toString()).toBe('1.5');
    expect(input.dayPlanDays).toBe(3);
    expect(input).toMatchObject({ termId: 't-1', startsAt: parts.stored.startsAt });
  });

  it('prices a day plan with no premium at 1 and no days at 0', async () => {
    const parts = setup();
    await open(parts, contract({ planType: PlanType.DAY }));
    const input = (parts.invoices.issueDayPlanInvoice.mock.calls[0] as unknown[])[0] as {
      dayPremium: Prisma.Decimal;
      dayPlanDays: number;
    };
    expect(input.dayPremium.toString()).toBe('1');
    expect(input.dayPlanDays).toBe(0);
  });
});

describe('RequestHoldExpiryJob', () => {
  const setup = (expired: { id: string; code: string }[], expireHold: jest.Mock) => {
    const contracts = { expiredHolds: jest.fn().mockResolvedValue(expired) };
    const job = new RequestHoldExpiryJob(
      contracts as unknown as ContractsRepository,
      { expireHold } as unknown as ContractDecisionsService,
    );
    return { job, contracts };
  };

  let logged: jest.SpyInstance;
  let failed: jest.SpyInstance;
  beforeEach(() => {
    logged = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    failed = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    logged.mockRestore();
    failed.mockRestore();
  });

  it('looks for expired holds at the current time when none is given', async () => {
    jest.useFakeTimers({
      now: AT,
      doNotFake: [
        'hrtime',
        'nextTick',
        'performance',
        'queueMicrotask',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'requestIdleCallback',
        'cancelIdleCallback',
        'setImmediate',
        'clearImmediate',
        'setInterval',
        'clearInterval',
        'setTimeout',
        'clearTimeout',
      ],
    });
    try {
      const { job, contracts } = setup([], jest.fn());
      await expect(job.run()).resolves.toBe(0);
      expect(contracts.expiredHolds).toHaveBeenCalledWith(AT);
    } finally {
      jest.useRealTimers();
    }
  });

  it('counts only the holds that were cancelled and logs each', async () => {
    const expireHold = jest.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const { job } = setup(
      [
        { id: 'c-1', code: 'RC-1' },
        { id: 'c-2', code: 'RC-2' },
      ],
      expireHold,
    );
    await expect(job.run(AT)).resolves.toBe(1);
    expect(expireHold).toHaveBeenNthCalledWith(1, 'c-1', AT);
    expect(expireHold).toHaveBeenNthCalledWith(2, 'c-2', AT);
    expect(logged).toHaveBeenCalledTimes(1);
  });

  it('logs a failed hold and goes on with the next one, whatever was thrown', async () => {
    const expireHold = jest
      .fn()
      .mockRejectedValueOnce(new Error('lock timeout'))
      .mockRejectedValueOnce('plain text')
      .mockResolvedValueOnce(true);
    const { job } = setup(
      [
        { id: 'c-1', code: 'RC-1' },
        { id: 'c-2', code: 'RC-2' },
        { id: 'c-3', code: 'RC-3' },
      ],
      expireHold,
    );
    await expect(job.run(AT)).resolves.toBe(1);
    expect(failed).toHaveBeenCalledTimes(2);
    expect((failed.mock.calls[0] as unknown[])[1]).toEqual(expect.stringContaining('lock timeout'));
    expect((failed.mock.calls[1] as unknown[])[1]).toBe('plain text');
  });
});

describe('DTO transforms', () => {
  const errorsOf = <T extends object>(type: new () => T, plain: Record<string, unknown>) =>
    validate(plainToInstance(type, plain));

  it('trims the name of a new group and refuses a blank or a non-text name', async () => {
    expect(plainToInstance(CreateGroupDto, { name: '  North  ' }).name).toBe('North');
    expect(await errorsOf(CreateGroupDto, { name: '  North  ' })).toHaveLength(0);
    expect(await errorsOf(CreateGroupDto, { name: '   ' })).not.toHaveLength(0);
    expect(plainToInstance(CreateGroupDto, { name: 42 }).name).toBe(42);
    expect(await errorsOf(CreateGroupDto, { name: 42 })).not.toHaveLength(0);
  });

  it('checks the name of a group update only when it is sent, and trims it', async () => {
    expect(await errorsOf(UpdateGroupDto, { expectedVersion: 1 })).toHaveLength(0);
    expect(plainToInstance(UpdateGroupDto, { name: ' South ', expectedVersion: 1 }).name).toBe(
      'South',
    );
    expect(await errorsOf(UpdateGroupDto, { name: '   ', expectedVersion: 1 })).not.toHaveLength(0);
    expect(plainToInstance(UpdateGroupDto, { name: 7, expectedVersion: 1 }).name).toBe(7);
    expect(await errorsOf(UpdateGroupDto, { name: 7, expectedVersion: 1 })).not.toHaveLength(0);
  });

  it('trims the search text of the contract list and refuses one that is not text', async () => {
    expect(plainToInstance(ContractQueryDto, { q: '  acme  ' }).q).toBe('acme');
    expect(plainToInstance(ContractQueryDto, { q: 5 }).q).toBe(5);
    expect(await errorsOf(ContractQueryDto, { q: 5 })).not.toHaveLength(0);
  });

  it('trims the reason of End now and of a unit release', async () => {
    for (const type of [EndNowDto, ReleaseUnitDto]) {
      expect(plainToInstance(type, { reason: '  Trip over  ', expectedVersion: 1 }).reason).toBe(
        'Trip over',
      );
      expect(await errorsOf(type, { reason: '   ', expectedVersion: 1 })).not.toHaveLength(0);
      expect(plainToInstance(type, { reason: 9, expectedVersion: 1 }).reason).toBe(9);
      expect(await errorsOf(type, { reason: 9, expectedVersion: 1 })).not.toHaveLength(0);
    }
  });

  it('takes the counter checks of the preview as an array that is not JSON text', () => {
    const checks = [{ deviceId: 'd-1', batteryPct: 90, gpsFixOk: true }];
    const query = plainToInstance(HandoverPreviewQueryDto, { checks });
    expect(query.checks).toEqual(checks);
  });
});

describe('demo panel options (D-110)', () => {
  it('reads the 100 newest contracts a panel action can still move', async () => {
    const { calls, prisma } = recorder();
    await new ContractsRepository(prisma).panelOptions();
    expect(calls[0][0]).toBe('rentalContract.findMany');
    expect(argsOf(calls, 0)).toEqual({
      where: {
        status: { in: ['REQUESTED', 'APPROVED', 'ACTIVE', 'ENDING', 'RETURN_DUE', 'RETURNED'] },
      },
      select: { id: true, code: true, status: true, version: true, organizationId: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });

  it('is answered by the contracts repository through the service', () => {
    const options = [{ id: 'c-1' }];
    const contracts = { panelOptions: jest.fn().mockReturnValue(options) };
    const service = Object.create(ContractsService.prototype) as ContractsService;
    Object.assign(service, { contracts });
    expect(service.panelOptions()).toBe(options);
    expect(contracts.panelOptions).toHaveBeenCalledTimes(1);
  });
});
