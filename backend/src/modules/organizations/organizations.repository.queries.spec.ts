import {
  ComplianceActionKind,
  ComplianceCaseStatus,
  ComplianceCaseType,
  OrganizationStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ComplianceCasesRepository } from './compliance-cases.repository';
import { OrganizationsRepository } from './organizations.repository';

type Calls = [string, unknown][];
type Answer = unknown;

// A Prisma stand-in that records delegate calls as [model.operation, args] and the tagged raw queries as
// [$executeRaw or $queryRaw, { sql, values }]. `answers` replaces the default answer of one call; a
// function answers each call in turn.
const recorder = (answers: Record<string, Answer> = {}) => {
  const calls: Calls = [];
  const defaults: Record<string, unknown> = {
    findMany: [],
    findFirst: null,
    findUnique: null,
    count: 0,
    updateMany: { count: 1 },
  };
  const answer = (key: string, operation: string, args: unknown) => {
    if (!(key in answers)) return operation in defaults ? defaults[operation] : {};
    const value = answers[key];
    return typeof value === 'function' ? (value as (args: unknown) => unknown)(args) : value;
  };
  const client = new Proxy(
    {},
    {
      get: (_target, name: string) => {
        if (name === '$executeRaw' || name === '$queryRaw') {
          return (strings: TemplateStringsArray, ...values: unknown[]) => {
            calls.push([name, { sql: strings.join('?'), values }]);
            return Promise.resolve(answer(name, name, values));
          };
        }
        return new Proxy(
          {},
          {
            get: (_inner, operation: string) => (args: unknown) => {
              const key = `${name}.${operation}`;
              calls.push([key, args]);
              return Promise.resolve(answer(key, operation, args));
            },
          },
        );
      },
    },
  );
  return { calls, prisma: client as unknown as PrismaService & Prisma.TransactionClient };
};

const sequence = (...values: unknown[]) => {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
};

const argsOf = (calls: Calls, index: number) => calls[index][1] as Record<string, unknown>;
const AT = new Date('2026-11-20T03:00:00Z');

describe('OrganizationsRepository queries', () => {
  const setup = (answers: Record<string, Answer> = {}) => {
    const { calls, prisma } = recorder(answers);
    return { calls, prisma, repository: new OrganizationsRepository(prisma) };
  };

  it('reads the status of an organization, or null for an unknown one', async () => {
    const found = setup({ 'organization.findUnique': { status: OrganizationStatus.ACTIVE } });
    await expect(found.repository.findStatus('org-1')).resolves.toBe(OrganizationStatus.ACTIVE);
    expect(argsOf(found.calls, 0)).toEqual({ where: { id: 'org-1' }, select: { status: true } });
    await expect(setup().repository.findStatus('org-2')).resolves.toBeNull();
  });

  it('reads the detail row with the account that verified it', async () => {
    const { repository, calls } = setup();
    await repository.findDetail('org-1');
    expect(calls[0][0]).toBe('organization.findUnique');
    expect(argsOf(calls, 0).where).toEqual({ id: 'org-1' });
    expect((argsOf(calls, 0).select as Record<string, boolean>).verifiedById).toBe(true);
  });

  it('reads the channel key version, or null for an unknown organization', async () => {
    const found = setup({ 'organization.findUnique': { channelKeyVersion: 3 } });
    await expect(found.repository.channelKeyVersion('org-1')).resolves.toBe(3);
    expect(argsOf(found.calls, 0).select).toEqual({ channelKeyVersion: true });
    await expect(setup().repository.channelKeyVersion('org-2')).resolves.toBeNull();
  });

  it('reads the channel key version and its exposure through the default client', async () => {
    const state = { channelKeyVersion: 2, channelKeyExposedAt: AT };
    const { repository, calls } = setup({ 'organization.findUnique': state });
    await expect(repository.channelKeyState('org-1')).resolves.toBe(state);
    expect(argsOf(calls, 0).select).toEqual({ channelKeyVersion: true, channelKeyExposedAt: true });
  });

  it('reads the labels of the organizations named', async () => {
    const { repository, calls } = setup();
    await repository.labels(['org-1', 'org-2']);
    expect(calls[0][0]).toBe('organization.findMany');
    expect(argsOf(calls, 0)).toEqual({
      where: { id: { in: ['org-1', 'org-2'] } },
      select: { id: true, code: true, legalName: true },
    });
  });

  it('matches the legal name or the code with the text read literally', async () => {
    const { repository, calls } = setup({
      'organization.findMany': [{ id: 'org-1' }, { id: 'org-2' }],
    });
    await expect(repository.idsMatching('50%_off')).resolves.toEqual(['org-1', 'org-2']);
    expect(argsOf(calls, 0).where).toEqual({
      OR: [
        { legalName: { contains: '50\\%\\_off', mode: 'insensitive' } },
        { code: { contains: '50\\%\\_off', mode: 'insensitive' } },
      ],
    });
  });

  it('reads the party of a handover note by organization id', async () => {
    const { repository, calls } = setup();
    await repository.party('org-1');
    expect(argsOf(calls, 0).where).toEqual({ id: 'org-1' });
    expect(argsOf(calls, 0).select).toMatchObject({ masterContractRef: true, ndaSigned: true });
  });

  describe('page', () => {
    it('lists newest first with no filter, through the default client', async () => {
      const { repository, calls } = setup();
      await repository.page({}, 20, 10);
      expect(calls[0][0]).toBe('organization.findMany');
      expect(argsOf(calls, 0)).toMatchObject({
        where: {},
        orderBy: { createdAt: 'desc' },
        skip: 20,
        take: 10,
      });
      expect(calls[1][0]).toBe('organization.count');
      expect(argsOf(calls, 1).where).toEqual({});
    });

    it('filters by status through the caller transaction', async () => {
      const { repository, prisma, calls } = setup();
      await repository.page({ status: OrganizationStatus.PENDING }, 0, 5, prisma);
      expect(argsOf(calls, 0).where).toEqual({ status: OrganizationStatus.PENDING });
    });

    it('searches the name, the code and the tax code with the text read literally', async () => {
      const { repository, calls } = setup();
      await repository.page({ q: 'a_b' }, 0, 5);
      expect(argsOf(calls, 0).where).toEqual({
        OR: [
          { legalName: { contains: 'a\\_b', mode: 'insensitive' } },
          { code: { contains: 'a\\_b', mode: 'insensitive' } },
          { taxCode: { contains: 'a\\_b' } },
        ],
      });
      expect(argsOf(calls, 1).where).toEqual(argsOf(calls, 0).where);
    });
  });

  describe('nextCode', () => {
    const next = async (rows: unknown) => {
      const { repository, prisma } = setup({ $queryRaw: rows });
      return repository.nextCode(prisma);
    };

    it('starts at ORG-0001 when no organization has a code, or the max is null', async () => {
      await expect(next([])).resolves.toBe('ORG-0001');
      await expect(next([{ max: null }])).resolves.toBe('ORG-0001');
    });

    it('takes the highest suffix plus one, padded to four digits', async () => {
      await expect(next([{ max: 7 }])).resolves.toBe('ORG-0008');
      await expect(next([{ max: 12 }])).resolves.toBe('ORG-0013');
      await expect(next([{ max: 9999 }])).resolves.toBe('ORG-10000');
    });
  });

  it('creates a pending organization and selects the review row', async () => {
    const { repository, prisma, calls } = setup();
    const data = {
      code: 'ORG-0003',
      legalName: 'Acme Trek',
      taxCode: '0109876543',
      address: '12 Le Loi',
      contactEmail: 'a@b.vn',
      contactPhone: '0901234567',
    };
    await repository.createPending(data, prisma);
    expect(calls[0][0]).toBe('organization.create');
    expect(argsOf(calls, 0).data).toBe(data);
  });

  it('says whether a tax code is taken', async () => {
    const taken = setup({ 'organization.count': 1 });
    await expect(taken.repository.taxCodeTaken('0109876543')).resolves.toBe(true);
    expect(argsOf(taken.calls, 0).where).toEqual({ taxCode: '0109876543' });
    await expect(setup().repository.taxCodeTaken('0100000000')).resolves.toBe(false);
  });

  it('reads the status under a share lock, or null for an unknown organization', async () => {
    const found = setup({ $queryRaw: [{ status: OrganizationStatus.SUSPENDED }] });
    await expect(found.repository.lockStatus('org-1', found.prisma)).resolves.toBe(
      OrganizationStatus.SUSPENDED,
    );
    const { sql, values } = found.calls[0][1] as { sql: string; values: unknown[] };
    expect(sql).toContain('FOR SHARE');
    expect(values).toEqual(['org-1']);
    const missing = setup({ $queryRaw: [] });
    await expect(missing.repository.lockStatus('org-2', missing.prisma)).resolves.toBeNull();
  });

  it('locks the row for update and then reads it', async () => {
    const { repository, prisma, calls } = setup({
      'organization.findUnique': { id: 'org-1' },
    });
    await expect(repository.lockById('org-1', prisma)).resolves.toEqual({ id: 'org-1' });
    expect(calls.map(([name]) => name)).toEqual(['$queryRaw', 'organization.findUnique']);
    expect((calls[0][1] as { sql: string }).sql).toContain('FOR UPDATE');
  });

  it('reads the contact email, or null for an unknown organization', async () => {
    const found = setup({ 'organization.findUnique': { contactEmail: 'a@b.vn' } });
    await expect(found.repository.contactEmail('org-1')).resolves.toBe('a@b.vn');
    await expect(setup().repository.contactEmail('org-2')).resolves.toBeNull();
  });

  describe('update', () => {
    it('answers null and reads nothing when someone else saved first', async () => {
      const { repository, prisma, calls } = setup({ 'organization.updateMany': { count: 0 } });
      await expect(repository.update('org-1', 3, { address: 'x' }, prisma)).resolves.toBeNull();
      expect(calls.map(([name]) => name)).toEqual(['organization.updateMany']);
    });

    it('bumps the version when the caller saw the current one and answers the row', async () => {
      const { repository, prisma, calls } = setup({
        'organization.findUnique': { id: 'org-1', version: 4 },
      });
      await expect(
        repository.update('org-1', 3, { address: 'x', verifiedById: 'u-1' }, prisma),
      ).resolves.toEqual({ id: 'org-1', version: 4 });
      expect(argsOf(calls, 0)).toEqual({
        where: { id: 'org-1', version: 3 },
        data: { address: 'x', verifiedById: 'u-1', version: { increment: 1 } },
      });
      expect(calls[1][0]).toBe('organization.findUnique');
    });
  });

  it('adds a transition and reads the history oldest first', async () => {
    const { repository, prisma, calls } = setup();
    const row = {
      organizationId: 'org-1',
      fromStatus: null,
      toStatus: OrganizationStatus.PENDING,
      actorId: null,
    };
    await repository.addTransition(row, prisma);
    await repository.transitionsOf('org-1');
    expect(calls[0]).toEqual(['organizationTransition.create', { data: row }]);
    expect(calls[1][0]).toBe('organizationTransition.findMany');
    expect(argsOf(calls, 1).where).toEqual({ organizationId: 'org-1' });
    expect(argsOf(calls, 1).orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });

  it('lists the Field Stations not revoked, of one organization or of every one', async () => {
    const { repository, calls } = setup();
    await repository.activeFieldStations(null);
    await repository.activeFieldStations('org-1');
    expect(argsOf(calls, 0).where).toEqual({ revokedAt: null });
    expect(argsOf(calls, 1).where).toEqual({ revokedAt: null, organizationId: 'org-1' });
    expect(argsOf(calls, 0).orderBy).toEqual([{ createdAt: 'asc' }, { id: 'asc' }]);
  });
});

describe('ComplianceCasesRepository queries', () => {
  const setup = (answers: Record<string, Answer> = {}) => {
    const { calls, prisma } = recorder(answers);
    return { calls, prisma, repository: new ComplianceCasesRepository(prisma) };
  };

  it('lists cases newest first with no filter, through the default client', async () => {
    const { repository, calls } = setup();
    await repository.page({}, 0, 20);
    expect(argsOf(calls, 0)).toMatchObject({
      where: {},
      orderBy: [{ openedAt: 'desc' }, { id: 'asc' }],
      skip: 0,
      take: 20,
    });
    expect(argsOf(calls, 1).where).toEqual({});
  });

  it('filters the list by status through the caller transaction', async () => {
    const { repository, prisma, calls } = setup();
    await repository.page({ status: ComplianceCaseStatus.CLOSED }, 0, 20, prisma);
    expect(argsOf(calls, 0).where).toEqual({ status: ComplianceCaseStatus.CLOSED });
    expect(argsOf(calls, 1).where).toEqual({ status: ComplianceCaseStatus.CLOSED });
  });

  it('finds one case through the default client', async () => {
    const { repository, calls } = setup();
    await repository.find('cc-1');
    expect(argsOf(calls, 0).where).toEqual({ id: 'cc-1' });
  });

  it('locks the case row for update and reads it', async () => {
    const { repository, prisma, calls } = setup({ 'complianceCase.findUnique': { id: 'cc-1' } });
    await expect(repository.lock('cc-1', prisma)).resolves.toEqual({ id: 'cc-1' });
    expect(calls.map(([name]) => name)).toEqual(['$queryRaw', 'complianceCase.findUnique']);
    expect((calls[0][1] as { sql: string }).sql).toContain('FOR UPDATE');
  });

  it('takes the advisory lock before it reads the highest code', async () => {
    const { repository, prisma, calls } = setup({ $queryRaw: [{ max: 9 }] });
    await expect(repository.nextCode(prisma)).resolves.toBe('CMP-0010');
    expect(calls.map(([name]) => name)).toEqual(['$executeRaw', '$queryRaw']);
    const empty = setup({ $queryRaw: [] });
    await expect(empty.repository.nextCode(empty.prisma)).resolves.toBe('CMP-0001');
    const nullMax = setup({ $queryRaw: [{ max: null }] });
    await expect(nullMax.repository.nextCode(nullMax.prisma)).resolves.toBe('CMP-0001');
  });

  it('creates a case and an action, and reads nothing else', async () => {
    const { repository, prisma, calls } = setup();
    const data = {
      code: 'CMP-0001',
      organizationId: 'org-1',
      type: ComplianceCaseType.SUSPECTED_THEFT,
      evidence: 'e',
      linkedContractIds: ['c-1'],
      openedById: 'u-1',
    };
    await repository.create(data, prisma);
    const action = {
      caseId: 'cc-1',
      kind: 'NOTE' as ComplianceActionKind,
      targetId: null,
      note: 'n',
      actorId: 'u-1',
    };
    await repository.addAction(action, prisma);
    expect(calls[0][0]).toBe('complianceCase.create');
    expect(argsOf(calls, 0).data).toBe(data);
    expect(calls[1]).toEqual(['complianceAction.create', { data: action }]);
  });

  describe('findOpenOfType', () => {
    const open = { id: 'cc-1', status: ComplianceCaseStatus.OPEN };

    it('answers null when no case of the type is open, after taking the lock of the pair', async () => {
      const { repository, prisma, calls } = setup();
      await expect(
        repository.findOpenOfType('org-1', ComplianceCaseType.SUSPECTED_THEFT, prisma),
      ).resolves.toBeNull();
      const { values } = calls[0][1] as { values: unknown[] };
      expect(calls[0][0]).toBe('$executeRaw');
      expect(values).toEqual([`compliance_cases.open.org-1.${ComplianceCaseType.SUSPECTED_THEFT}`]);
      expect(argsOf(calls, 1).where).toEqual({
        organizationId: 'org-1',
        type: ComplianceCaseType.SUSPECTED_THEFT,
        status: ComplianceCaseStatus.OPEN,
      });
      expect(argsOf(calls, 1).orderBy).toEqual([{ openedAt: 'asc' }, { id: 'asc' }]);
    });

    it('answers the oldest case once it is locked and still open', async () => {
      const { repository, prisma } = setup({
        'complianceCase.findFirst': { id: 'cc-1' },
        'complianceCase.findUnique': open,
      });
      await expect(
        repository.findOpenOfType('org-1', ComplianceCaseType.SUSPECTED_THEFT, prisma),
      ).resolves.toEqual(open);
    });

    it('takes the next open case when the first closed before it was locked', async () => {
      const second = { id: 'cc-2', status: ComplianceCaseStatus.OPEN };
      const { repository, prisma } = setup({
        'complianceCase.findFirst': sequence({ id: 'cc-1' }, { id: 'cc-2' }),
        'complianceCase.findUnique': sequence(
          { id: 'cc-1', status: ComplianceCaseStatus.CLOSED },
          second,
        ),
      });
      await expect(
        repository.findOpenOfType('org-1', ComplianceCaseType.SUSPECTED_THEFT, prisma),
      ).resolves.toEqual(second);
    });

    it('keeps looking when the case it found has gone, and ends with null', async () => {
      const { repository, prisma } = setup({
        'complianceCase.findFirst': sequence({ id: 'cc-1' }, null),
        'complianceCase.findUnique': null,
      });
      await expect(
        repository.findOpenOfType('org-1', ComplianceCaseType.SUSPECTED_THEFT, prisma),
      ).resolves.toBeNull();
    });
  });

  it('records the authority reference only on an open case that has none', async () => {
    const set = setup();
    await expect(set.repository.setAuthorityReference('cc-1', 'PR-1', set.prisma)).resolves.toBe(
      true,
    );
    expect(argsOf(set.calls, 0)).toEqual({
      where: { id: 'cc-1', status: ComplianceCaseStatus.OPEN, authorityReference: null },
      data: { authorityReference: 'PR-1' },
    });
    const had = setup({ 'complianceCase.updateMany': { count: 0 } });
    await expect(had.repository.setAuthorityReference('cc-1', 'PR-1', had.prisma)).resolves.toBe(
      false,
    );
  });

  it('closes an open case once and says whether it did', async () => {
    const closed = setup();
    const data = { outcome: 'Found', authorityReference: 'PR-1', closedById: 'u-1', at: AT };
    await expect(closed.repository.close('cc-1', data, closed.prisma)).resolves.toBe(true);
    expect(argsOf(closed.calls, 0)).toEqual({
      where: { id: 'cc-1', status: ComplianceCaseStatus.OPEN },
      data: {
        status: ComplianceCaseStatus.CLOSED,
        outcome: 'Found',
        authorityReference: 'PR-1',
        closedById: 'u-1',
        closedAt: AT,
      },
    });
    const again = setup({ 'complianceCase.updateMany': { count: 0 } });
    await expect(again.repository.close('cc-1', data, again.prisma)).resolves.toBe(false);
  });
});
