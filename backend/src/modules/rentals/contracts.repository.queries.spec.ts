import { ContractStatus, FaultResolution, PlanType, Prisma } from '@prisma/client';
import { ErrorCode } from '../../common/errors';
import { PrismaService } from '../../common/prisma/prisma.service';
import { FINISHED_STATES, RUNNING_STATES } from './contract-states';
import {
  CONTRACT_SORT_FIELDS,
  ContractsRepository,
  RESERVATION_REMINDED,
  RESERVATION_STAFF_REMINDED,
} from './contracts.repository';

type Calls = [string, Record<string, unknown>][];

// A Prisma stand-in that records every delegate call as [model.operation, args]. `answers` replaces the
// default answer of one `model.operation`; the defaults are the empty result of each operation.
const recorder = (answers: Record<string, unknown> = {}) => {
  const calls: Calls = [];
  const defaults: Record<string, unknown> = {
    count: 0,
    updateMany: { count: 1 },
    findUnique: null,
    findFirst: null,
    findMany: [],
  };
  const client = new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_inner, operation: string) => (args: Record<string, unknown>) => {
              const key = `${model}.${operation}`;
              calls.push([key, args]);
              return Promise.resolve(
                key in answers ? answers[key] : operation in defaults ? defaults[operation] : {},
              );
            },
          },
        ),
    },
  );
  const prisma = client as unknown as PrismaService & Prisma.TransactionClient;
  return { calls, prisma, repository: new ContractsRepository(prisma) };
};

const AT = new Date('2026-11-20T03:00:00Z');
const FROM = new Date('2026-11-01T00:00:00Z');

describe('ContractsRepository queries', () => {
  describe('findById', () => {
    it('reads one contract without a lock', async () => {
      const { repository, prisma, calls } = recorder({
        'rentalContract.findUnique': { id: 'c-1' },
      });
      await expect(repository.findById('c-1', prisma)).resolves.toEqual({ id: 'c-1' });
      expect(calls).toHaveLength(1);
      expect(calls[0][0]).toBe('rentalContract.findUnique');
      expect(calls[0][1].where).toEqual({ id: 'c-1' });
    });

    it('answers 404 NOT_FOUND for an unknown contract', async () => {
      const { repository, prisma } = recorder();
      await expect(repository.findById('missing', prisma)).rejects.toMatchObject({
        errorCode: ErrorCode.NOT_FOUND,
      });
    });
  });

  describe('custody and monitoring reads', () => {
    it('reads the holder labels of handed-over rows for the pairs given, latest first', async () => {
      const { repository, calls } = recorder();
      await repository.findHolderLabels([
        { contractId: 'c-1', deviceId: 'd-1' },
        { contractId: 'c-2', deviceId: 'd-2' },
      ]);
      expect(calls[0][0]).toBe('contractDevice.findMany');
      expect(calls[0][1]).toMatchObject({
        where: {
          handedOverAt: { not: null },
          OR: [
            { contractId: 'c-1', deviceId: 'd-1' },
            { contractId: 'c-2', deviceId: 'd-2' },
          ],
        },
        orderBy: { handedOverAt: 'desc' },
      });
    });

    it('reads the devices in custody for every organization when the scope is null', async () => {
      const { repository, calls } = recorder();
      await repository.findInCustody(null);
      expect(calls[0][1].where).toEqual({
        handedOverAt: { not: null },
        releasedAt: null,
        checkedInAt: null,
        lostAt: null,
      });
      expect(calls[0][1].orderBy).toEqual({ handedOverAt: 'asc' });
    });

    it('limits the custody read to one organization and to the devices named', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.findInCustody('org-1', prisma, ['d-1', 'd-2']);
      await repository.findInCustody('org-1');
      await repository.findInCustody(null, prisma, []);
      expect(calls[0][1].where).toEqual({
        handedOverAt: { not: null },
        releasedAt: null,
        checkedInAt: null,
        lostAt: null,
        deviceId: { in: ['d-1', 'd-2'] },
        contract: { organizationId: 'org-1' },
      });
      expect(calls[1][1].where).toEqual({
        handedOverAt: { not: null },
        releasedAt: null,
        checkedInAt: null,
        lostAt: null,
        contract: { organizationId: 'org-1' },
      });
      expect(calls[2][1].where).toEqual({
        handedOverAt: { not: null },
        releasedAt: null,
        checkedInAt: null,
        lostAt: null,
        deviceId: { in: [] },
      });
    });

    it('answers whether the contract belongs to the organization', async () => {
      const found = recorder({ 'rentalContract.findFirst': { id: 'c-1' } });
      await expect(found.repository.existsForOrganization('c-1', 'org-1')).resolves.toBe(true);
      expect(found.calls[0][1].where).toEqual({ id: 'c-1', organizationId: 'org-1' });
      const missing = recorder();
      await expect(missing.repository.existsForOrganization('c-1', 'org-2')).resolves.toBe(false);
    });

    it('selects the live custody rows of an organization for the devices named', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.liveRowsOfOrganization('org-1', ['d-1'], prisma);
      expect(calls[0][0]).toBe('contractDevice.findMany');
      expect(calls[0][1].where).toEqual({
        deviceId: { in: ['d-1'] },
        contract: { organizationId: 'org-1' },
        releasedAt: null,
        handedOverAt: { not: null },
        checkedInAt: null,
        lostAt: null,
        replacedBy: null,
      });
    });

    it('reads every contract row of a device, oldest reservation first', async () => {
      const { repository, calls } = recorder();
      await repository.contractRowsOfDevice('d-1');
      expect(calls[0][1]).toMatchObject({
        where: { deviceId: 'd-1' },
        orderBy: { reservedAt: 'asc' },
      });
    });

    it('selects the handed-over rows whose custody overlaps a range through the default client', async () => {
      const { repository, calls } = recorder();
      await repository.intervalsOverlapping(FROM, AT);
      expect(calls[0][1].where).toEqual({
        handedOverAt: { lt: AT },
        AND: [
          { OR: [{ checkedInAt: null }, { checkedInAt: { gt: FROM } }] },
          { OR: [{ lostAt: null }, { lostAt: { gt: FROM } }] },
        ],
      });
    });

    it('counts the running and the unfinished contracts of an organization', async () => {
      const { repository, calls } = recorder({ 'rentalContract.count': 4 });
      await expect(repository.countRunningContracts('org-1')).resolves.toBe(4);
      await expect(repository.countUnfinishedContracts('org-1')).resolves.toBe(4);
      expect(calls[0][1].where).toEqual({
        organizationId: 'org-1',
        status: { in: [...RUNNING_STATES] },
      });
      expect(calls[1][1].where).toEqual({
        organizationId: 'org-1',
        status: { notIn: [...FINISHED_STATES] },
      });
    });

    it('reads the live contract of each device with its contract through the default client', async () => {
      const { repository, calls } = recorder();
      await repository.liveContractsOfDevices(['d-1', 'd-2']);
      expect(calls[0][1].where).toEqual({
        deviceId: { in: ['d-1', 'd-2'] },
        releasedAt: null,
        replacedBy: { is: null },
        checkedInAt: null,
        lostAt: null,
      });
    });
  });

  describe('faults and custody units', () => {
    it('resolves the open faults of the rows with the resolution and time given', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.resolveOpenFaults(['r-1', 'r-2'], 'RETURNED' as FaultResolution, AT, prisma);
      expect(calls[0][0]).toBe('deviceFaultReport.updateMany');
      expect(calls[0][1]).toEqual({
        where: { contractDeviceId: { in: ['r-1', 'r-2'] }, resolvedAt: null },
        data: { resolvedAt: AT, resolution: 'RETURNED' },
      });
    });

    it('reads one custody unit of a contract or fails', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.custodyUnit('c-1', 'r-1', prisma);
      expect(calls[0][0]).toBe('contractDevice.findFirstOrThrow');
      expect(calls[0][1]).toMatchObject({ where: { contractId: 'c-1', id: 'r-1' } });
    });
  });

  describe('page sorting and search', () => {
    it.each(CONTRACT_SORT_FIELDS)('sorts by %s then by id in the same direction', async (field) => {
      const { repository, prisma, calls } = recorder();
      await repository.page({}, 0, 20, prisma, { field, order: 'desc' });
      expect(calls[0][1].orderBy).toEqual([{ [field]: 'desc' }, { id: 'desc' }]);
    });

    it('keeps the default order, newest status change first, without a sort', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.page({}, 0, 20, prisma);
      expect(calls[0][1].orderBy).toEqual([{ statusChangedAt: 'desc' }, { code: 'desc' }]);
    });

    it('searches the code alone when no organization matched the text', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.page({ search: { q: '50%_off', organizationIds: [] } }, 0, 20, prisma);
      expect(calls[0][1].where).toEqual({
        OR: [{ code: { contains: '50\\%\\_off', mode: 'insensitive' } }],
      });
    });

    it('searches the code or the organizations the text matched', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.page(
        { search: { q: 'acme', organizationIds: ['org-1', 'org-2'] } },
        0,
        20,
        prisma,
      );
      expect(calls[0][1].where).toEqual({
        OR: [
          { code: { contains: 'acme', mode: 'insensitive' } },
          { organizationId: { in: ['org-1', 'org-2'] } },
        ],
      });
    });

    it('applies the organization, status and plan filters together with the search', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.page(
        {
          organizationId: 'org-1',
          status: ContractStatus.ACTIVE,
          planType: PlanType.DAY,
          search: { q: 'rc', organizationIds: [] },
        },
        40,
        20,
        prisma,
      );
      expect(calls[0][1]).toMatchObject({
        where: {
          organizationId: 'org-1',
          status: ContractStatus.ACTIVE,
          planType: PlanType.DAY,
        },
        skip: 40,
        take: 20,
      });
      expect(calls[1][0]).toBe('rentalContract.count');
      expect(calls[1][1].where).toEqual(calls[0][1].where);
    });
  });

  describe('writes through the caller transaction', () => {
    it('moves the dates of one term', async () => {
      const { repository, prisma, calls } = recorder();
      const dates = { startsAt: FROM, endsAt: AT };
      await repository.setTermDates('t-1', dates, prisma);
      expect(calls).toEqual([['contractTerm.update', { where: { id: 't-1' }, data: dates }]]);
    });

    it('ends the contract now and makes its devices due at the same time', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.recordEarlyEnd('c-1', AT, prisma);
      expect(calls).toEqual([
        ['rentalContract.update', { where: { id: 'c-1' }, data: { endsAt: AT, returnDueAt: AT } }],
      ]);
    });

    it('sets the return due time', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.setReturnDueAt('c-1', AT, prisma);
      expect(calls).toEqual([
        ['rentalContract.update', { where: { id: 'c-1' }, data: { returnDueAt: AT } }],
      ]);
    });

    it('stamps the time a contract went overdue or defaulted', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.stampOverdue('c-1', { overdueAt: AT }, prisma);
      await repository.stampOverdue('c-1', { defaultedAt: AT }, prisma);
      expect(calls).toEqual([
        ['rentalContract.update', { where: { id: 'c-1' }, data: { overdueAt: AT } }],
        ['rentalContract.update', { where: { id: 'c-1' }, data: { defaultedAt: AT } }],
      ]);
    });

    it('returns the device ids of the reserved rows it released', async () => {
      const { repository, prisma, calls } = recorder({
        'contractDevice.findMany': [{ deviceId: 'd-1' }, { deviceId: 'd-2' }],
      });
      await expect(repository.releaseReservedRows('c-1', AT, prisma)).resolves.toEqual([
        'd-1',
        'd-2',
      ]);
      expect(calls[1][0]).toBe('contractDevice.updateMany');
      expect(calls[1][1]).toEqual({
        where: { contractId: 'c-1', releasedAt: null, handedOverAt: null },
        data: { releasedAt: AT },
      });
    });

    it('checks the rows in only while they are not checked in already', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.markCheckedIn(['r-1', 'r-2'], AT, 'u-1', prisma);
      expect(calls).toEqual([
        [
          'contractDevice.updateMany',
          {
            where: { id: { in: ['r-1', 'r-2'] }, checkedInAt: null },
            data: { checkedInAt: AT, checkedInById: 'u-1' },
          },
        ],
      ]);
    });

    it('erases the holder labels of every row of the contract', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.eraseLabels('c-1', prisma);
      expect(calls[0][1]).toEqual({
        where: { contractId: 'c-1' },
        data: { holderName: null, holderPhone: null, holderEmergencyContact: null },
      });
    });

    it('inserts a replacement row reserved at its handover time', async () => {
      const { repository, prisma, calls } = recorder({ 'contractDevice.create': { id: 'r-9' } });
      const row = {
        contractId: 'c-1',
        deviceId: 'd-9',
        replacesId: 'r-1',
        handedOverAt: AT,
        replacementNotePath: 'RN.pdf',
        replacementNoteSha256: 'abc',
      };
      await expect(repository.insertReplacementRow(row, prisma)).resolves.toEqual({ id: 'r-9' });
      expect(calls[0][1]).toEqual({ data: { ...row, reservedAt: AT }, select: { id: true } });
    });

    it('inserts a unit release', async () => {
      const { repository, prisma, calls } = recorder();
      const data = { contractId: 'c-1' } as unknown as Prisma.UnitReleaseUncheckedCreateInput;
      await repository.insertUnitRelease(data, prisma);
      expect(calls).toEqual([['unitRelease.create', { data }]]);
    });
  });

  describe('compare-and-set writes', () => {
    it('lowers the quantity only when the caller saw the current version', async () => {
      const won = recorder();
      await expect(won.repository.setQuantity('c-1', 3, 2, won.prisma)).resolves.toBe(true);
      expect(won.calls[0][1]).toEqual({
        where: { id: 'c-1', version: 3 },
        data: { quantity: 2, version: { increment: 1 } },
      });
      const lost = recorder({ 'rentalContract.updateMany': { count: 0 } });
      await expect(lost.repository.setQuantity('c-1', 3, 2, lost.prisma)).resolves.toBe(false);
    });

    it('closes an open term once', async () => {
      const first = recorder();
      await expect(first.repository.closeTerm('t-1', first.prisma)).resolves.toBe(true);
      expect(first.calls[0][1]).toEqual({
        where: { id: 't-1', status: 'OPEN' },
        data: { status: 'CLOSED' },
      });
      const again = recorder({ 'contractTerm.updateMany': { count: 0 } });
      await expect(again.repository.closeTerm('t-1', again.prisma)).resolves.toBe(false);
    });

    it('releases rows from a running contract and refuses a row that is already closed', async () => {
      const ok = recorder();
      await ok.repository.markReleased(['r-1'], AT, 'u-1', ok.prisma);
      expect(ok.calls[0][1]).toEqual({
        where: {
          id: { in: ['r-1'] },
          handedOverAt: { not: null },
          releasedAt: null,
          checkedInAt: null,
          lostAt: null,
        },
        data: { checkedInAt: AT, checkedInById: 'u-1' },
      });
      const closed = recorder({ 'contractDevice.updateMany': { count: 1 } });
      await expect(
        closed.repository.markReleased(['r-1', 'r-2'], AT, 'u-1', closed.prisma),
      ).rejects.toMatchObject({ errorCode: ErrorCode.INVALID_STATE_TRANSITION });
    });
  });

  describe('reads for other modules', () => {
    it('reads a contract by its code', async () => {
      const { repository, calls } = recorder();
      await repository.findByCode('RC-2026-0001');
      expect(calls[0][0]).toBe('rentalContract.findUnique');
      expect(calls[0][1].where).toEqual({ code: 'RC-2026-0001' });
    });

    it('lists the contracts of one hardware variant and the status of one contract', async () => {
      const { repository, calls } = recorder();
      await repository.idsOfVariant('v-3');
      await repository.statusOf('c-1');
      expect(calls[0][1]).toEqual({ where: { hardwareVariantId: 'v-3' }, select: { id: true } });
      expect(calls[1][1]).toEqual({ where: { id: 'c-1' }, select: { status: true } });
    });

    it('lists the unit releases behind service credits', async () => {
      const { repository, calls } = recorder();
      await repository.releaseNotes(['u-1', 'u-2']);
      expect(calls[0][0]).toBe('unitRelease.findMany');
      expect(calls[0][1].where).toEqual({ id: { in: ['u-1', 'u-2'] } });
    });

    it('lists the handed-over rows not back, replaced rows included', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.rowsNotBack('c-1', prisma);
      expect(calls[0][1]).toMatchObject({
        where: {
          contractId: 'c-1',
          releasedAt: null,
          handedOverAt: { not: null },
          checkedInAt: null,
          lostAt: null,
        },
        orderBy: { reservedAt: 'asc' },
      });
    });

    it('reads the credit basis only when the contract and the unit both exist', async () => {
      const both = recorder({
        'rentalContract.findUnique': { id: 'c-1' },
        'contractDevice.findFirst': { id: 'r-1' },
      });
      await expect(both.repository.creditBasis('c-1', 'r-1')).resolves.toEqual({
        contract: { id: 'c-1' },
        unit: { id: 'r-1' },
      });
      expect(both.calls[1][1].where).toEqual({ id: 'r-1', contractId: 'c-1' });
      const noUnit = recorder({ 'rentalContract.findUnique': { id: 'c-1' } });
      await expect(noUnit.repository.creditBasis('c-1', 'r-1')).resolves.toBeNull();
      const noContract = recorder({ 'contractDevice.findFirst': { id: 'r-1' } });
      await expect(noContract.repository.creditBasis('c-1', 'r-1')).resolves.toBeNull();
    });
  });

  describe('handover notes in the database', () => {
    it('upserts the bytes under the note name', async () => {
      const { repository, calls } = recorder();
      await repository.saveNote('c-1.pdf', Buffer.from([1, 2, 3]));
      expect(calls[0][0]).toBe('handoverNote.upsert');
      expect(calls[0][1].where).toEqual({ name: 'c-1.pdf' });
      expect(calls[0][1].create).toEqual({ name: 'c-1.pdf', pdf: new Uint8Array([1, 2, 3]) });
      expect(calls[0][1].update).toEqual({ pdf: new Uint8Array([1, 2, 3]) });
    });

    it('reads the bytes back, or null when no note has that name', async () => {
      const found = recorder({ 'handoverNote.findUnique': { pdf: new Uint8Array([4, 5]) } });
      await expect(found.repository.readNote('c-1.pdf')).resolves.toEqual(Buffer.from([4, 5]));
      const missing = recorder();
      await expect(missing.repository.readNote('c-1.pdf')).resolves.toBeNull();
    });
  });

  describe('job selections', () => {
    it('selects RETURN_DUE contracts due at or before the time, oldest first', async () => {
      const { repository, calls } = recorder();
      await repository.returnDueBefore(AT);
      expect(calls[0][1]).toEqual({
        where: { status: ContractStatus.RETURN_DUE, returnDueAt: { lte: AT } },
        select: { id: true },
        orderBy: { returnDueAt: 'asc' },
      });
    });

    it('selects OVERDUE contracts that became overdue strictly before the time', async () => {
      const { repository, calls } = recorder();
      await repository.overdueBefore(AT);
      expect(calls[0][1]).toEqual({
        where: { status: ContractStatus.OVERDUE, overdueAt: { lt: AT } },
        select: { id: true },
        orderBy: { overdueAt: 'asc' },
      });
    });

    it('selects the open terms that ended on contracts the rollover moves', async () => {
      const { repository, calls } = recorder();
      await repository.dueTerms(AT);
      expect(calls[0][0]).toBe('contractTerm.findMany');
      expect(calls[0][1]).toMatchObject({
        where: {
          status: 'OPEN',
          endsAt: { lte: AT },
          contract: { status: { in: [ContractStatus.ACTIVE, ContractStatus.ENDING] } },
        },
        orderBy: { endsAt: 'asc' },
      });
    });

    it('asks for both reminder audiences by default', async () => {
      const { repository, calls } = recorder();
      await repository.reservationsToRemind(AT);
      expect(calls[0][1]).toMatchObject({
        where: {
          status: ContractStatus.APPROVED,
          reservationExpiresAt: { lte: AT },
          OR: [
            { transitions: { none: { reason: RESERVATION_REMINDED } } },
            { transitions: { none: { reason: RESERVATION_STAFF_REMINDED } } },
          ],
        },
        orderBy: { reservationExpiresAt: 'asc' },
      });
    });

    it('asks for the Manager reminder alone without Staff notifications', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.reservationsToRemind(AT, false, prisma);
      expect(calls[0][1].where).toEqual({
        status: ContractStatus.APPROVED,
        reservationExpiresAt: { lte: AT },
        OR: [{ transitions: { none: { reason: RESERVATION_REMINDED } } }],
      });
    });
  });

  describe('reminder flags', () => {
    it('reports a reminder once a transition row carries its reason', async () => {
      const none = recorder();
      await expect(none.repository.hasReminder('c-1', none.prisma)).resolves.toBe(false);
      expect(none.calls[0][1].where).toEqual({ contractId: 'c-1', reason: RESERVATION_REMINDED });
      const flagged = recorder({ 'contractTransition.count': 2 });
      await expect(
        flagged.repository.hasReminder('c-1', flagged.prisma, RESERVATION_STAFF_REMINDED),
      ).resolves.toBe(true);
      expect(flagged.calls[0][1].where).toEqual({
        contractId: 'c-1',
        reason: RESERVATION_STAFF_REMINDED,
      });
    });

    it('flags a reminder as an APPROVED to APPROVED system transition', async () => {
      const { repository, prisma, calls } = recorder();
      await repository.flagReminded('c-1', AT, prisma);
      await repository.flagReminded('c-1', AT, prisma, RESERVATION_STAFF_REMINDED);
      const row = (reason: string) => ({
        data: {
          contractId: 'c-1',
          fromStatus: ContractStatus.APPROVED,
          toStatus: ContractStatus.APPROVED,
          actorId: null,
          reason,
          createdAt: AT,
        },
      });
      expect(calls).toEqual([
        ['contractTransition.create', row(RESERVATION_REMINDED)],
        ['contractTransition.create', row(RESERVATION_STAFF_REMINDED)],
      ]);
    });
  });
});
