import { ComplianceCaseStatus } from '@prisma/client';
import { COMPLIANCE_CASE_ROW, ComplianceCasesRepository } from './compliance-cases.repository';

const AT = new Date('2026-10-30T03:00:00.000Z');

describe('ComplianceCasesRepository', () => {
  let complianceCase: Record<string, jest.Mock>;
  let complianceAction: Record<string, jest.Mock>;
  let apiKey: Record<string, jest.Mock>;
  let queryRaw: jest.Mock;
  let repository: ComplianceCasesRepository;
  let client: unknown;

  beforeEach(() => {
    complianceCase = {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      findUnique: jest.fn().mockResolvedValue({ id: 'case-1' }),
      create: jest.fn().mockResolvedValue({ id: 'case-1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    };
    complianceAction = { create: jest.fn().mockResolvedValue({ id: 'action-1' }) };
    apiKey = {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      count: jest.fn().mockResolvedValue(1),
    };
    queryRaw = jest.fn();
    client = {
      complianceCase,
      complianceAction,
      apiKey,
      $queryRaw: queryRaw,
    };
    repository = new ComplianceCasesRepository({} as never);
  });

  it('pages with the status filter and without one, newest first', async () => {
    await repository.page({ status: ComplianceCaseStatus.OPEN }, 0, 20, client as never);
    expect(complianceCase.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: ComplianceCaseStatus.OPEN },
        orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
        select: COMPLIANCE_CASE_ROW,
      }),
    );
    await repository.page({}, 0, 20, client as never);
    expect(complianceCase.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });

  it('finds one case by id, with the select shape', async () => {
    await repository.find('case-1', client as never);
    expect(complianceCase.findUnique).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      select: COMPLIANCE_CASE_ROW,
    });
  });

  it('locks the row with FOR UPDATE before reading it', async () => {
    await repository.lock('case-1', client as never);
    expect(queryRaw).toHaveBeenCalledWith(
      expect.arrayContaining([expect.stringContaining('FOR UPDATE')]),
      'case-1',
    );
    expect(complianceCase.findUnique).toHaveBeenCalledWith({
      where: { id: 'case-1' },
      select: COMPLIANCE_CASE_ROW,
    });
  });

  it('takes an advisory lock before computing the next CMP- code', async () => {
    queryRaw.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ max: 2 }]);
    await expect(repository.nextCode(client as never)).resolves.toBe('CMP-0003');
    const [sql] = queryRaw.mock.calls[0] as [string[]];
    expect(sql[0]).toContain('pg_advisory_xact_lock');
  });

  it('pads the first code to CMP-0001 when none exist', async () => {
    queryRaw.mockResolvedValueOnce(undefined).mockResolvedValueOnce([{ max: null }]);
    await expect(repository.nextCode(client as never)).resolves.toBe('CMP-0001');
  });

  it('creates a case and an action row', async () => {
    const data = {
      code: 'CMP-0001',
      organizationId: 'org-1',
      type: 'OTHER_BREACH' as never,
      evidence: 'x',
      linkedContractIds: [],
      openedById: 'u-1',
    };
    await repository.create(data, client as never);
    expect(complianceCase.create).toHaveBeenCalledWith({ data, select: COMPLIANCE_CASE_ROW });

    const action = {
      caseId: 'case-1',
      kind: 'OTHER' as never,
      targetId: null,
      note: 'x',
      actorId: 'u-1',
    };
    await repository.addAction(action, client as never);
    expect(complianceAction.create).toHaveBeenCalledWith({ data: action });
  });

  it('closes only an OPEN case, and answers whether a row changed', async () => {
    await expect(
      repository.close(
        'case-1',
        { outcome: 'Done', authorityReference: null, closedById: 'u-1', at: AT },
        client as never,
      ),
    ).resolves.toBe(true);
    expect(complianceCase.updateMany).toHaveBeenCalledWith({
      where: { id: 'case-1', status: ComplianceCaseStatus.OPEN },
      data: {
        status: ComplianceCaseStatus.CLOSED,
        outcome: 'Done',
        authorityReference: null,
        closedById: 'u-1',
        closedAt: AT,
      },
    });
    complianceCase.updateMany.mockResolvedValue({ count: 0 });
    await expect(
      repository.close(
        'case-1',
        { outcome: 'Done', authorityReference: null, closedById: 'u-1', at: AT },
        client as never,
      ),
    ).resolves.toBe(false);
  });
});
