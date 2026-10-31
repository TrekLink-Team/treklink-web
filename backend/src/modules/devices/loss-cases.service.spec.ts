import { HttpStatus } from '@nestjs/common';
import { DeviceStatus, LossCaseState, LossCustody, LossDecision, Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { LossCaseRow } from './loss-cases.repository';
import { LOSS_CASE_REPORTED, LossCaseService } from './loss-cases.service';

// devices task 2.7 (design §2.1, REQ-EVT-11, REQ-EVT-13 to REQ-EVT-16, REQ-ERR-05, REQ-ERR-06,
// AC-05 to AC-08). The repositories, ports and listeners are mocks; the transaction runs the callback.
const at = new Date('2026-10-31T03:00:00Z');
const tx = { tx: true } as never;

const STAFF = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const STAFF_2 = { id: 'staff-2', roles: ['STAFF'], organizationId: null };
const ADMIN = { id: 'admin-1', roles: ['ADMIN'], organizationId: null };
const MANAGER = { id: 'mgr-1', roles: ['ORG_MANAGER'], organizationId: 'org-1' };
const OTHER_MANAGER = { id: 'mgr-2', roles: ['ORG_MANAGER'], organizationId: 'org-2' };

const INTERVAL = { contractId: 'c-1', organizationId: 'org-1', contractDeviceId: 'cd-1' };

const caseRow = (overrides: Partial<LossCaseRow> = {}): LossCaseRow => ({
  id: 'lc-1',
  code: 'LOSS-0001',
  deviceId: 'dev-1',
  device: { id: 'dev-1', assetTag: 'TL-0042' },
  state: LossCaseState.REPORTED,
  stateFromDevice: DeviceStatus.RENTED,
  reportedById: 'mgr-1',
  reportedAt: new Date('2026-10-30T10:00:00Z'),
  description: 'Last seen at Phan Dung camp',
  lastSeenAt: new Date('2026-10-30T08:00:00Z'),
  lastLatitude: 11.55,
  lastLongitude: 108.53,
  custody: null,
  contractDeviceId: 'cd-1',
  contractId: 'c-1',
  organizationId: 'org-1',
  keyExposed: false,
  suspectedTheft: false,
  policeReference: null,
  complianceCaseId: null,
  triagedById: null,
  triagedAt: null,
  searchEndsAt: null,
  recoveredAt: null,
  confirmedAt: null,
  decision: null,
  chargeVnd: null,
  decisionReason: null,
  decidedById: null,
  settledAt: null,
  version: 0,
  ...overrides,
});

const renterCase = (overrides: Partial<LossCaseRow> = {}) =>
  caseRow({ custody: LossCustody.RENTER, keyExposed: true, triagedById: 'staff-1', ...overrides });

const treklinkCase = (overrides: Partial<LossCaseRow> = {}) =>
  caseRow({
    custody: LossCustody.TREKLINK,
    contractDeviceId: null,
    contractId: null,
    organizationId: null,
    stateFromDevice: DeviceStatus.AVAILABLE,
    reportedById: 'staff-1',
    triagedById: 'staff-1',
    ...overrides,
  });

const expectDomain = async (promise: Promise<unknown>, status: HttpStatus, code: ErrorCode) => {
  const error = await promise.then(
    () => undefined,
    (thrown: unknown) => thrown,
  );
  expect(error).toBeInstanceOf(DomainException);
  expect((error as DomainException).getStatus()).toBe(status);
  expect(JSON.stringify((error as DomainException).getResponse())).toContain(code);
};

describe('LossCaseService', () => {
  let cases: {
    find: jest.Mock;
    nextCode: jest.Mock;
    insert: jest.Mock;
    transition: jest.Mock;
    page: jest.Mock;
    dueForConfirmation: jest.Mock;
  };
  let devices: {
    findDetail: jest.Mock;
    findUnit: jest.Mock;
    hasOpenLossCase: jest.Mock;
    moveIfCurrent: jest.Mock;
    insertTransition: jest.Mock;
  };
  let fleet: { valueAt: jest.Mock };
  let organizations: { labelsOf: jest.Mock };
  let parameters: { get: jest.Mock };
  let notifier: { confirmed: jest.Mock; settled: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let custody: { custodyAt: jest.Mock };
  let channelKeys: { markKeyExposed: jest.Mock };
  let orgActions: { openOrLinkComplianceCase: jest.Mock };
  let service: LossCaseService;

  // The transition mock answers the row with the update applied, as the repository re-reads it.
  const transitionsTo = (base: LossCaseRow) =>
    cases.transition.mockImplementation(
      (_id: string, _from: LossCaseState, version: number, data: Partial<LossCaseRow>) =>
        Promise.resolve({ ...base, ...data, version: version + 1 }),
    );

  const emitted = (name: string): unknown[] =>
    (events.emitAfterCommit.mock.calls as [string, unknown][])
      .filter(([event]) => event === name)
      .map(([, payload]) => payload);

  beforeEach(() => {
    cases = {
      find: jest.fn(),
      nextCode: jest.fn().mockResolvedValue('LOSS-0001'),
      insert: jest.fn((data: Partial<LossCaseRow>) =>
        Promise.resolve(caseRow({ ...data, device: { id: 'dev-1', assetTag: 'TL-0042' } })),
      ),
      transition: jest.fn(),
      page: jest.fn().mockResolvedValue([[], 0]),
      dueForConfirmation: jest.fn().mockResolvedValue([]),
    };
    devices = {
      findDetail: jest.fn().mockResolvedValue({
        id: 'dev-1',
        status: DeviceStatus.RENTED,
        version: 7,
        lastSeenAt: new Date('2026-10-30T08:00:00Z'),
        lastLatitude: 11.55,
        lastLongitude: 108.53,
      }),
      findUnit: jest.fn().mockResolvedValue({ id: 'dev-1', status: DeviceStatus.LOST, version: 8 }),
      hasOpenLossCase: jest.fn().mockResolvedValue(false),
      moveIfCurrent: jest.fn().mockResolvedValue(true),
      insertTransition: jest.fn(),
    };
    fleet = { valueAt: jest.fn().mockResolvedValue(1_800_000) };
    organizations = {
      labelsOf: jest
        .fn()
        .mockResolvedValue(new Map([['org-1', { id: 'org-1', code: 'ORG-0007', legalName: 'X' }]])),
    };
    parameters = { get: jest.fn().mockResolvedValue(7) };
    notifier = { confirmed: jest.fn(), settled: jest.fn() };
    events = {
      transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    custody = { custodyAt: jest.fn().mockResolvedValue(INTERVAL) };
    channelKeys = { markKeyExposed: jest.fn().mockResolvedValue(true) };
    orgActions = { openOrLinkComplianceCase: jest.fn().mockResolvedValue('cmp-1') };
    const config = {
      get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
    };
    service = new LossCaseService(
      cases as never,
      devices as never,
      fleet as never,
      organizations as never,
      parameters as never,
      notifier as never,
      events as never,
      config as never,
      custody,
      channelKeys as never,
      orgActions,
    );
  });

  describe('report (api-design 17)', () => {
    it('moves a RENTED device to LOST and opens a REPORTED case with the last seen time (REQ-EVT-13)', async () => {
      const dto = await service.report('dev-1', { description: '  Lost near camp ' }, MANAGER, at);

      // The custody read runs in the report transaction, so a check-in committed first is seen.
      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', at, tx);
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        7,
        [DeviceStatus.RENTED],
        DeviceStatus.LOST,
        at,
        tx,
      );
      expect(cases.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LOSS-0001',
          state: LossCaseState.REPORTED,
          stateFromDevice: DeviceStatus.RENTED,
          reportedById: 'mgr-1',
          description: 'Lost near camp',
          lastSeenAt: new Date('2026-10-30T08:00:00Z'),
          organizationId: 'org-1',
          contractId: 'c-1',
          contractDeviceId: 'cd-1',
        }),
        tx,
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: DeviceStatus.RENTED,
          toStatus: DeviceStatus.LOST,
          reason: 'LOSS_REPORTED',
          refType: 'LOSS_CASE',
        }),
        tx,
      );
      expect(dto).toMatchObject({
        code: 'LOSS-0001',
        state: LossCaseState.REPORTED,
        organization: { id: 'org-1', code: 'ORG-0007' },
        lastPosition: { lat: 11.55, lon: 108.53 },
      });
      expect(emitted(LOSS_CASE_REPORTED)).toEqual([
        expect.objectContaining({ code: 'LOSS-0001', byOrganization: true }),
      ]);
      expect(emitted(AUDIT_RECORD)).toEqual([
        expect.objectContaining({ action: 'lossCase.report', subjectType: 'LossCase' }),
      ]);
    });

    it('lets Staff report an AVAILABLE device that no organization holds', async () => {
      devices.findDetail.mockResolvedValue({
        id: 'dev-1',
        status: DeviceStatus.AVAILABLE,
        version: 2,
        lastSeenAt: null,
        lastLatitude: null,
        lastLongitude: null,
      });
      custody.custodyAt.mockResolvedValue(null);

      const dto = await service.report(
        'dev-1',
        { description: 'Missing at stock-take' },
        STAFF,
        at,
      );

      expect(cases.insert).toHaveBeenCalledWith(
        expect.objectContaining({ organizationId: null, stateFromDevice: DeviceStatus.AVAILABLE }),
        tx,
      );
      expect(dto.organization).toBeNull();
      expect(dto.lastPosition).toBeNull();
    });

    it('answers 404 to an Org Manager whose organization does not hold the device', async () => {
      await expectDomain(
        service.report('dev-1', { description: 'x' }, OTHER_MANAGER, at),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
      expect(devices.moveIfCurrent).not.toHaveBeenCalled();
    });

    it('refuses a second open case with 409 LOSS_CASE_OPEN (REQ-ERR-05)', async () => {
      devices.hasOpenLossCase.mockResolvedValue(true);
      await expectDomain(
        service.report('dev-1', { description: 'x' }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.LOSS_CASE_OPEN,
      );
    });

    it('maps the one-open-case index violation of a concurrent report to LOSS_CASE_OPEN', async () => {
      cases.insert.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' }),
      );
      await expectDomain(
        service.report('dev-1', { description: 'x' }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.LOSS_CASE_OPEN,
      );
    });

    it('refuses a device out of service with 409 INVALID_STATE_TRANSITION', async () => {
      devices.findDetail.mockResolvedValue({
        id: 'dev-1',
        status: DeviceStatus.RETIRED,
        version: 3,
      });
      await expectDomain(
        service.report('dev-1', { description: 'x' }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    });

    it('answers 409 STALE_VERSION when the device moved meanwhile', async () => {
      devices.moveIfCurrent.mockResolvedValue(false);
      await expectDomain(
        service.report('dev-1', { description: 'x' }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(cases.insert).not.toHaveBeenCalled();
    });
  });

  describe('triage (api-design 19)', () => {
    it('records RENTER custody, exposes the key and starts the search window (AC-06)', async () => {
      const current = caseRow();
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.triage(
        'lc-1',
        { suspectedTheft: false, policeReference: '  ', expectedVersion: 0 },
        STAFF,
        at,
      );

      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', current.lastSeenAt, tx);
      expect(channelKeys.markKeyExposed).toHaveBeenCalledWith('org-1', at, STAFF, tx);
      expect(orgActions.openOrLinkComplianceCase).not.toHaveBeenCalled();
      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.REPORTED,
        0,
        expect.objectContaining({
          state: LossCaseState.SEARCHING,
          custody: LossCustody.RENTER,
          keyExposed: true,
          policeReference: null,
          triagedById: 'staff-1',
          searchEndsAt: new Date('2026-11-07T03:00:00Z'),
        }),
        tx,
      );
      expect(dto).toMatchObject({ state: 'SEARCHING', custody: 'RENTER', keyExposed: true });
    });

    it('records TREKLINK custody when no interval contains the time, keeping the reporter organization (AC-05)', async () => {
      const current = caseRow({ lastSeenAt: null });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);
      custody.custodyAt.mockResolvedValue(null);

      await service.triage('lc-1', { suspectedTheft: true, expectedVersion: 0 }, STAFF, at);

      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', current.reportedAt, tx);
      expect(channelKeys.markKeyExposed).not.toHaveBeenCalled();
      expect(orgActions.openOrLinkComplianceCase).not.toHaveBeenCalled();
      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.REPORTED,
        0,
        expect.objectContaining({
          custody: LossCustody.TREKLINK,
          contractId: null,
          contractDeviceId: null,
          organizationId: 'org-1',
          keyExposed: false,
          suspectedTheft: true,
        }),
        tx,
      );
    });

    it('records TREKLINK custody when the rental of the last seen time was returned before the report (ruling 2026-10-31)', async () => {
      const current = caseRow({ stateFromDevice: DeviceStatus.RETURNED });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);
      // Last heard while still out on cd-1; at the report time the unit was back, in no interval.
      custody.custodyAt.mockImplementation((_id: string, when: Date) =>
        Promise.resolve(when.getTime() === current.reportedAt.getTime() ? null : INTERVAL),
      );

      await service.triage('lc-1', { suspectedTheft: false, expectedVersion: 0 }, STAFF, at);

      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', current.reportedAt, tx);
      expect(custody.custodyAt).toHaveBeenCalledWith('dev-1', current.lastSeenAt, tx);
      expect(channelKeys.markKeyExposed).not.toHaveBeenCalled();
      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.REPORTED,
        0,
        expect.objectContaining({
          custody: LossCustody.TREKLINK,
          contractId: null,
          contractDeviceId: null,
          keyExposed: false,
        }),
        tx,
      );
    });

    it('records the renter holding the unit at the report time when an earlier rental held the last seen time', async () => {
      const current = caseRow();
      cases.find.mockResolvedValue(current);
      transitionsTo(current);
      const later = { contractId: 'c-2', organizationId: 'org-2', contractDeviceId: 'cd-2' };
      custody.custodyAt.mockImplementation((_id: string, when: Date) =>
        Promise.resolve(when.getTime() === current.reportedAt.getTime() ? later : INTERVAL),
      );

      await service.triage('lc-1', { suspectedTheft: false, expectedVersion: 0 }, STAFF, at);

      expect(channelKeys.markKeyExposed).toHaveBeenCalledWith('org-2', at, STAFF, tx);
      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.REPORTED,
        0,
        expect.objectContaining({
          custody: LossCustody.RENTER,
          contractId: 'c-2',
          contractDeviceId: 'cd-2',
        }),
        tx,
      );
    });

    it('opens or links a compliance case for a suspected theft in renter custody (D-046)', async () => {
      cases.find.mockResolvedValue(caseRow());
      transitionsTo(caseRow());

      await service.triage(
        'lc-1',
        { suspectedTheft: true, policeReference: 'CA-PD-2026-118', expectedVersion: 0 },
        STAFF,
        at,
      );

      expect(orgActions.openOrLinkComplianceCase).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: 'org-1',
          lossCaseId: 'lc-1',
          policeReference: 'CA-PD-2026-118',
          actorId: 'staff-1',
        }),
        tx,
      );
      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.REPORTED,
        0,
        expect.objectContaining({ complianceCaseId: 'cmp-1' }),
        tx,
      );
    });

    it('refuses a case that is not REPORTED, and a stale version', async () => {
      cases.find.mockResolvedValue(caseRow({ state: LossCaseState.SEARCHING }));
      await expectDomain(
        service.triage('lc-1', { suspectedTheft: false, expectedVersion: 0 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      cases.find.mockResolvedValue(caseRow({ version: 3 }));
      await expectDomain(
        service.triage('lc-1', { suspectedTheft: false, expectedVersion: 2 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
    });

    it('answers 404 for an unknown case', async () => {
      cases.find.mockResolvedValue(null);
      await expectDomain(
        service.triage('lc-9', { suspectedTheft: false, expectedVersion: 0 }, STAFF, at),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
    });
  });

  describe('confirm (api-design 21) and the search job', () => {
    it('raises the remaining value for RENTER custody and calls every onConfirmed (AC-06)', async () => {
      const current = renterCase({ state: LossCaseState.SEARCHING, version: 1 });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.confirm('lc-1', { expectedVersion: 1 }, STAFF, at);

      expect(fleet.valueAt).toHaveBeenCalledWith('dev-1', at);
      expect(notifier.confirmed).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'LOSS-0001',
          custody: LossCustody.RENTER,
          custodyContract: INTERVAL,
          confirmedAt: at,
          chargeVnd: 1_800_000,
        }),
        tx,
      );
      expect(dto).toMatchObject({ state: 'CONFIRMED', chargeVnd: 1_800_000 });
    });

    it('raises no charge for TREKLINK custody (AC-05)', async () => {
      const current = treklinkCase({ state: LossCaseState.SEARCHING, version: 1 });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.confirm('lc-1', { expectedVersion: 1 }, STAFF, at);

      expect(fleet.valueAt).not.toHaveBeenCalled();
      expect(notifier.confirmed).toHaveBeenCalledWith(
        expect.objectContaining({ custodyContract: null, chargeVnd: null }),
        tx,
      );
      expect(dto.chargeVnd).toBeNull();
    });

    it('refuses a REPORTED case with 409 and a lost compare-and-set with STALE_VERSION', async () => {
      cases.find.mockResolvedValue(renterCase({ state: LossCaseState.REPORTED }));
      await expectDomain(
        service.confirm('lc-1', { expectedVersion: 0 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      cases.find.mockResolvedValue(renterCase({ state: LossCaseState.SEARCHING }));
      cases.transition.mockResolvedValue(null);
      await expectDomain(
        service.confirm('lc-1', { expectedVersion: 0 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.STALE_VERSION,
      );
      expect(notifier.confirmed).not.toHaveBeenCalled();
    });

    it('confirmDue confirms a due case as SYSTEM and skips one that is not due or already moved', async () => {
      const due = renterCase({
        state: LossCaseState.SEARCHING,
        searchEndsAt: new Date('2026-10-31T00:00:00Z'),
      });
      cases.find.mockResolvedValue(due);
      transitionsTo(due);
      expect(await service.confirmDue('lc-1', at)).toBe(true);
      expect(emitted(AUDIT_RECORD)).toEqual([expect.objectContaining({ actorId: null })]);

      cases.find.mockResolvedValue({ ...due, searchEndsAt: new Date('2026-11-01T00:00:00Z') });
      expect(await service.confirmDue('lc-1', at)).toBe(false);
      cases.find.mockResolvedValue({ ...due, state: LossCaseState.CONFIRMED });
      expect(await service.confirmDue('lc-1', at)).toBe(false);
      cases.find.mockResolvedValue(due);
      cases.transition.mockResolvedValue(null);
      expect(await service.confirmDue('lc-1', at)).toBe(false);
    });
  });

  describe('decide (api-design 22)', () => {
    const confirmed = (overrides: Partial<LossCaseRow> = {}) =>
      renterCase({
        state: LossCaseState.CONFIRMED,
        chargeVnd: 1_800_000,
        confirmedAt: at,
        version: 2,
        ...overrides,
      });

    it('refuses the Admin who triaged the case with 403 SEPARATION_OF_DUTY (AC-07)', async () => {
      cases.find.mockResolvedValue(confirmed({ triagedById: 'admin-1' }));
      await expectDomain(
        service.decide('lc-1', { decision: LossDecision.CHARGED, expectedVersion: 2 }, ADMIN, at),
        HttpStatus.FORBIDDEN,
        ErrorCode.SEPARATION_OF_DUTY,
      );
      expect(notifier.settled).not.toHaveBeenCalled();
    });

    it('settles a reduction, calls every onSettled and retires the device', async () => {
      const current = confirmed();
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.decide(
        'lc-1',
        {
          decision: LossDecision.REDUCED,
          chargeVnd: 900_000,
          reason: ' Police report ',
          expectedVersion: 2,
        },
        ADMIN,
        at,
      );

      expect(notifier.settled).toHaveBeenCalledWith(
        expect.objectContaining({
          chargeVnd: 900_000,
          decisionReason: 'Police report',
          decidedById: 'admin-1',
        }),
        LossDecision.REDUCED,
        tx,
      );
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        8,
        [DeviceStatus.LOST],
        DeviceStatus.RETIRED,
        at,
        tx,
        { retiredAt: at },
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: DeviceStatus.LOST,
          toStatus: DeviceStatus.RETIRED,
          reason: 'LOSS_SETTLED',
        }),
        tx,
      );
      expect(dto).toMatchObject({ state: 'SETTLED', decision: 'REDUCED', chargeVnd: 900_000 });
    });

    it('keeps the confirmed charge for CHARGED and records 0 for WAIVED', async () => {
      cases.find.mockResolvedValue(confirmed());
      transitionsTo(confirmed());
      expect(
        (
          await service.decide(
            'lc-1',
            { decision: LossDecision.CHARGED, expectedVersion: 2 },
            ADMIN,
            at,
          )
        ).chargeVnd,
      ).toBe(1_800_000);
      expect(
        (
          await service.decide(
            'lc-1',
            { decision: LossDecision.WAIVED, reason: 'Goodwill', expectedVersion: 2 },
            ADMIN,
            at,
          )
        ).chargeVnd,
      ).toBe(0);
    });

    it('writes off a TREKLINK custody case with no charge to any organization (AC-05)', async () => {
      const current = treklinkCase({
        state: LossCaseState.CONFIRMED,
        triagedById: 'staff-1',
        version: 2,
      });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.decide(
        'lc-1',
        { decision: LossDecision.WRITTEN_OFF, reason: 'Lost in the store', expectedVersion: 2 },
        ADMIN,
        at,
      );

      expect(notifier.settled).toHaveBeenCalledWith(
        expect.objectContaining({ custodyContract: null, chargeVnd: null }),
        LossDecision.WRITTEN_OFF,
        tx,
      );
      expect(dto.chargeVnd).toBeNull();
    });

    it.each([
      [
        'a charge on TREKLINK custody',
        treklinkCase({ state: LossCaseState.CONFIRMED, version: 2 }),
        { decision: LossDecision.CHARGED },
      ],
      [
        'a write-off of a renter loss',
        undefined,
        { decision: LossDecision.WRITTEN_OFF, reason: 'x' },
      ],
      ['a waiver with no reason', undefined, { decision: LossDecision.WAIVED }],
      ['a reduction with no amount', undefined, { decision: LossDecision.REDUCED, reason: 'x' }],
      [
        'a reduction not below the charge',
        undefined,
        { decision: LossDecision.REDUCED, chargeVnd: 1_800_000, reason: 'x' },
      ],
    ])('refuses %s with 400', async (_name, row, body) => {
      cases.find.mockResolvedValue(row ?? confirmed());
      await expectDomain(
        service.decide('lc-1', { ...body, expectedVersion: 2 }, ADMIN, at),
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(cases.transition).not.toHaveBeenCalled();
    });

    it('refuses a SEARCHING case with 409', async () => {
      cases.find.mockResolvedValue(renterCase({ state: LossCaseState.SEARCHING, version: 2 }));
      await expectDomain(
        service.decide('lc-1', { decision: LossDecision.CHARGED, expectedVersion: 2 }, ADMIN, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    });
  });

  describe('recover (api-design 20)', () => {
    it('moves a SEARCHING case to RECOVERED and the device LOST to RETURNED (AC-08)', async () => {
      const current = renterCase({ state: LossCaseState.SEARCHING, version: 1 });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);

      const dto = await service.recover(
        'lc-1',
        { note: ' Handed in ', expectedVersion: 1 },
        STAFF_2,
        at,
      );

      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.SEARCHING,
        1,
        { state: LossCaseState.RECOVERED, recoveredAt: at },
        tx,
      );
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        8,
        [DeviceStatus.LOST],
        DeviceStatus.RETURNED,
        at,
        tx,
        {},
      );
      expect(devices.insertTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          toStatus: DeviceStatus.RETURNED,
          reason: 'LOSS_RECOVERED',
          note: 'Handed in',
        }),
        tx,
      );
      expect(dto.state).toBe('RECOVERED');
    });

    it('keeps a SETTLED case SETTLED and brings the device back from RETIRED (E05-10)', async () => {
      const current = renterCase({ state: LossCaseState.SETTLED, version: 3 });
      cases.find.mockResolvedValue(current);
      transitionsTo(current);
      devices.findUnit.mockResolvedValue({ id: 'dev-1', status: DeviceStatus.RETIRED, version: 9 });

      const dto = await service.recover('lc-1', { note: 'Found', expectedVersion: 3 }, STAFF, at);

      expect(cases.transition).toHaveBeenCalledWith(
        'lc-1',
        LossCaseState.SETTLED,
        3,
        { state: LossCaseState.SETTLED, recoveredAt: at },
        tx,
      );
      expect(devices.moveIfCurrent).toHaveBeenCalledWith(
        'dev-1',
        9,
        [DeviceStatus.RETIRED],
        DeviceStatus.RETURNED,
        at,
        tx,
        { retiredAt: null },
      );
      expect(dto.state).toBe('SETTLED');
    });

    it('refuses a CONFIRMED case and a settled case already recovered', async () => {
      cases.find.mockResolvedValue(renterCase({ state: LossCaseState.CONFIRMED }));
      await expectDomain(
        service.recover('lc-1', { note: 'x', expectedVersion: 0 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
      cases.find.mockResolvedValue(renterCase({ state: LossCaseState.SETTLED, recoveredAt: at }));
      await expectDomain(
        service.recover('lc-1', { note: 'x', expectedVersion: 0 }, STAFF, at),
        HttpStatus.CONFLICT,
        ErrorCode.INVALID_STATE_TRANSITION,
      );
    });
  });

  describe('reads (api-design 18 and 27)', () => {
    it('scopes the list to the organization of an organization caller only', async () => {
      await service.list({ state: LossCaseState.SEARCHING }, MANAGER);
      expect(cases.page).toHaveBeenLastCalledWith(
        { state: LossCaseState.SEARCHING, organizationId: 'org-1' },
        0,
        20,
      );
      await service.list({}, STAFF);
      expect(cases.page).toHaveBeenLastCalledWith({ state: undefined }, 0, 20);
    });

    it("answers 404 for another organization's case", async () => {
      cases.find.mockResolvedValue(caseRow());
      await expect(service.get('lc-1', MANAGER)).resolves.toMatchObject({ id: 'lc-1' });
      await expectDomain(
        service.get('lc-1', OTHER_MANAGER),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
      await expect(service.get('lc-1', STAFF)).resolves.toMatchObject({ id: 'lc-1' });
    });

    it('omits the theft fields from an Org Manager read and keeps them for Staff (ruling 2026-10-31)', async () => {
      const theft = caseRow({ suspectedTheft: true, policeReference: 'CA-PD-2026-118' });
      cases.find.mockResolvedValue(theft);
      cases.page.mockResolvedValue([[theft], 1]);

      const own = await service.get('lc-1', MANAGER);
      expect(own).not.toHaveProperty('suspectedTheft');
      expect(own).not.toHaveProperty('policeReference');
      const [listed] = (await service.list({}, MANAGER)).items;
      expect(listed).not.toHaveProperty('suspectedTheft');
      expect(listed).not.toHaveProperty('policeReference');
      const reported = await service.report('dev-1', { description: 'x' }, MANAGER, at);
      expect(reported).not.toHaveProperty('suspectedTheft');

      expect(await service.get('lc-1', STAFF)).toMatchObject({
        suspectedTheft: true,
        policeReference: 'CA-PD-2026-118',
      });
      expect((await service.list({}, STAFF)).items[0]).toMatchObject({
        suspectedTheft: true,
        policeReference: 'CA-PD-2026-118',
      });
    });
  });
});
