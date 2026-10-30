import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthorityReport, Incident, IncidentState, Prisma } from '@prisma/client';
import { Caller } from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { AuthorityReportsService } from './authority-reports.service';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';

const STAFF: Caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const OPERATOR: Caller = { id: 'op-1', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const EMPTY = { primary: [], backup: [], managers: [], staff: [] };
const REPORTED_AT = new Date('2026-10-20T03:25:00Z');
const CLOSED_AT = new Date('2026-10-21T08:00:00Z');

const incident = (state: IncidentState, patch: Partial<Incident> = {}): Incident =>
  ({ id: 'inc-1', organizationId: 'org-a', state, version: 5, ...patch }) as Incident;
const report = (patch: Partial<AuthorityReport> = {}): AuthorityReport =>
  ({
    id: 'ar-1',
    incidentId: 'inc-1',
    contractId: null,
    reportedAt: REPORTED_AT,
    caseClosedAt: null,
    ...patch,
  }) as AuthorityReport;

describe('AuthorityReportsService (incidents task 4.3, api-design 08, 09 and 11)', () => {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  let incidents: { lockById: jest.Mock };
  let reports: { insert: jest.Mock; lockById: jest.Mock; closeCase: jest.Mock; page: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: AuthorityReportsService;

  beforeEach(() => {
    incidents = { lockById: jest.fn().mockResolvedValue(incident('ESCALATED')) };
    reports = {
      insert: jest.fn().mockResolvedValue({ id: 'ar-1' }),
      lockById: jest.fn().mockResolvedValue(report()),
      closeCase: jest
        .fn()
        .mockImplementation((id: string, caseClosedAt: Date) =>
          Promise.resolve(report({ id, caseClosedAt })),
        ),
      page: jest.fn().mockResolvedValue([[], 0]),
    };
    lifecycle = {
      apply: jest
        .fn()
        .mockImplementation((id: string, _from: IncidentState, to: IncidentState) =>
          Promise.resolve(incident(to, { id, version: 6 })),
        ),
    };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    const config = { get: (key: string) => (key === 'MAX_PAGE_SIZE' ? 100 : 20) };
    service = new AuthorityReportsService(
      incidents as unknown as IncidentsRepository,
      reports as unknown as AuthorityReportsRepository,
      lifecycle as unknown as IncidentLifecycle,
      events as unknown as TransactionalEvents,
      config as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  const expectError = async (promise: Promise<unknown>, status: number, code: ErrorCode) => {
    const error: unknown = await promise.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ errorCode: code });
    expect((error as DomainException).getStatus()).toBe(status);
    return error as DomainException;
  };

  describe('reportIncident (api-design 08)', () => {
    const input = {
      agency: '  Lam Dong provincial rescue (114) ',
      reference: ' LD-114-2026-1020-07 ',
      reportedAt: REPORTED_AT,
      note: '  Last position shared by phone. ',
      expectedVersion: 5,
    };

    it('moves an ESCALATED incident to REPORTED and writes the report in the same transaction', async () => {
      await expect(service.reportIncident('inc-1', input, STAFF)).resolves.toMatchObject({
        state: 'REPORTED',
        version: 6,
      });
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'inc-1',
        'ESCALATED',
        'REPORTED',
        { kind: 'STAFF', id: 'staff-1', roles: ['STAFF'] },
        {
          code: 'AUTHORITY_REPORTED',
          at: expect.any(Date) as unknown,
          recipients: EMPTY,
          expectedVersion: 5,
          note: 'Last position shared by phone.',
        },
        tx,
      );
      expect(reports.insert).toHaveBeenCalledWith(
        {
          incidentId: 'inc-1',
          agency: 'Lam Dong provincial rescue (114)',
          reference: 'LD-114-2026-1020-07',
          reportedAt: REPORTED_AT,
          reportedById: 'staff-1',
          note: 'Last position shared by phone.',
        },
        tx,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(AUDIT_RECORD, {
        actorId: 'staff-1',
        actorRoles: ['STAFF'],
        organizationId: 'org-a',
        action: 'authority_report.create',
        subjectType: 'AuthorityReport',
        subjectId: 'ar-1',
        after: {
          incidentId: 'inc-1',
          agency: 'Lam Dong provincial rescue (114)',
          reference: 'LD-114-2026-1020-07',
          reportedAt: REPORTED_AT,
        },
      });
    });

    it('reports an UNROUTED incident, which has no organization, with a blank note dropped', async () => {
      incidents.lockById.mockResolvedValue(incident('UNROUTED', { organizationId: null }));
      await service.reportIncident('inc-1', { ...input, note: '   ' }, STAFF);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'inc-1',
        'UNROUTED',
        'REPORTED',
        expect.anything(),
        expect.objectContaining({ note: undefined }),
        tx,
      );
      expect(reports.insert).toHaveBeenCalledWith(expect.objectContaining({ note: undefined }), tx);
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({ organizationId: null }),
      );
    });

    it('refuses an organization member before opening a transaction', async () => {
      await expectError(
        service.reportIncident('inc-1', input, OPERATOR),
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it.each([
      ['agency', { agency: '  ' }, 'agency is required.'],
      ['reference', { reference: '' }, 'reference is required.'],
      [
        'a reportedAt in the future',
        { reportedAt: new Date(Date.now() + 60_000) },
        'reportedAt must not be in the future.',
      ],
    ])('refuses a blank or invalid %s with 400', async (_label, patch, message) => {
      const error = await expectError(
        service.reportIncident('inc-1', { ...input, ...patch }, STAFF),
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(error.message).toBe(message);
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it('answers 404 for a missing incident', async () => {
      incidents.lockById.mockResolvedValue(null);
      await expectError(
        service.reportIncident('inc-1', input, STAFF),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
      expect(reports.insert).not.toHaveBeenCalled();
    });

    it.each(['NOTIFY_PRIMARY', 'ACKNOWLEDGED', 'REPORTED', 'CLOSED'] as const)(
      'refuses %s with 409 before the version is compared',
      async (state) => {
        incidents.lockById.mockResolvedValue(incident(state));
        const error = await expectError(
          service.reportIncident('inc-1', { ...input, expectedVersion: 99 }, STAFF),
          HttpStatus.CONFLICT,
          ErrorCode.INVALID_STATE_TRANSITION,
        );
        expect(error.message).toBe(`This cannot be done while it is ${state}.`);
        expect(lifecycle.apply).not.toHaveBeenCalled();
        expect(reports.insert).not.toHaveBeenCalled();
      },
    );

    it('writes no report when the lifecycle refuses a stale version', async () => {
      const stale = new DomainException(HttpStatus.CONFLICT, ErrorCode.STALE_VERSION, 'stale');
      lifecycle.apply.mockRejectedValue(stale);
      await expect(service.reportIncident('inc-1', input, STAFF)).rejects.toBe(stale);
      expect(reports.insert).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).not.toHaveBeenCalled();
    });
  });

  describe('closeCase (api-design 09)', () => {
    it('closes the case and moves a REPORTED incident to CLOSED', async () => {
      incidents.lockById.mockResolvedValue(incident('REPORTED'));
      await expect(
        service.closeCase('ar-1', { closedAt: CLOSED_AT, note: ' Found safe ' }, STAFF),
      ).resolves.toEqual({ id: 'ar-1', caseClosedAt: CLOSED_AT, incidentState: 'CLOSED' });
      expect(reports.closeCase).toHaveBeenCalledWith('ar-1', CLOSED_AT, 'staff-1', tx);
      expect(incidents.lockById).toHaveBeenCalledWith('inc-1', tx);
      expect(lifecycle.apply).toHaveBeenCalledWith(
        'inc-1',
        'REPORTED',
        'CLOSED',
        { kind: 'STAFF', id: 'staff-1', roles: ['STAFF'] },
        {
          code: 'CASE_CLOSED',
          at: expect.any(Date) as unknown,
          recipients: EMPTY,
          note: 'Found safe',
        },
        tx,
      );
      expect(events.emitAfterCommit).toHaveBeenCalledWith(AUDIT_RECORD, {
        actorId: 'staff-1',
        actorRoles: ['STAFF'],
        organizationId: 'org-a',
        action: 'authority_report.close_case',
        subjectType: 'AuthorityReport',
        subjectId: 'ar-1',
        after: { caseClosedAt: CLOSED_AT, note: 'Found safe', incidentState: 'CLOSED' },
      });
    });

    it('records the time only when a member acknowledged the incident after the report', async () => {
      incidents.lockById.mockResolvedValue(incident('ACKNOWLEDGED'));
      await expect(service.closeCase('ar-1', { closedAt: CLOSED_AT }, STAFF)).resolves.toEqual({
        id: 'ar-1',
        caseClosedAt: CLOSED_AT,
        incidentState: 'ACKNOWLEDGED',
      });
      expect(lifecycle.apply).not.toHaveBeenCalled();
    });

    it('records the time only on a contract report, which has no incident', async () => {
      reports.lockById.mockResolvedValue(report({ incidentId: null, contractId: 'c-1' }));
      await expect(service.closeCase('ar-1', { closedAt: CLOSED_AT }, STAFF)).resolves.toEqual({
        id: 'ar-1',
        caseClosedAt: CLOSED_AT,
        incidentState: null,
      });
      expect(incidents.lockById).not.toHaveBeenCalled();
      expect(events.emitAfterCommit).toHaveBeenCalledWith(
        AUDIT_RECORD,
        expect.objectContaining({ organizationId: null }),
      );
    });

    it('answers 404 for a missing report', async () => {
      reports.lockById.mockResolvedValue(null);
      const error = await expectError(
        service.closeCase('ar-1', { closedAt: CLOSED_AT }, STAFF),
        HttpStatus.NOT_FOUND,
        ErrorCode.NOT_FOUND,
      );
      expect(error.message).toBe('Authority report not found.');
    });

    it('refuses a second closure with 409 CASE_ALREADY_CLOSED and keeps the first', async () => {
      reports.lockById.mockResolvedValue(report({ caseClosedAt: CLOSED_AT }));
      const error = await expectError(
        service.closeCase('ar-1', { closedAt: new Date('2026-10-22T00:00:00Z') }, STAFF),
        HttpStatus.CONFLICT,
        ErrorCode.CASE_ALREADY_CLOSED,
      );
      expect(error.message).toBe('This cannot be done while it is CLOSED.');
      expect(reports.closeCase).not.toHaveBeenCalled();
    });

    it.each([
      [
        'before the report',
        new Date('2026-10-20T03:00:00Z'),
        'closedAt must not be before reportedAt.',
      ],
      ['in the future', new Date(Date.now() + 60_000), 'closedAt must not be in the future.'],
    ])('refuses a closure time %s with 400', async (_label, closedAt, message) => {
      const error = await expectError(
        service.closeCase('ar-1', { closedAt }, STAFF),
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(error.message).toBe(message);
      expect(reports.closeCase).not.toHaveBeenCalled();
    });

    it('refuses an organization member', async () => {
      await expectError(
        service.closeCase('ar-1', { closedAt: CLOSED_AT }, OPERATOR),
        HttpStatus.FORBIDDEN,
        ErrorCode.FORBIDDEN,
      );
      expect(events.transaction).not.toHaveBeenCalled();
    });

    it('fails loudly when the reported incident row is gone', async () => {
      incidents.lockById.mockResolvedValue(null);
      await expect(service.closeCase('ar-1', { closedAt: CLOSED_AT }, STAFF)).rejects.toThrow(
        'Authority report ar-1 has no incident.',
      );
    });
  });

  describe('list (api-design 11)', () => {
    const OPEN = { caseClosedAt: null };
    const DONE = { caseClosedAt: { not: null } };

    it.each([
      [true, OPEN],
      [false, DONE],
    ])('open=%s reads one group, newest first', async (open, where) => {
      reports.page.mockResolvedValue([[{ id: 'ar-1' }], 1]);
      await expect(service.list({ open })).resolves.toEqual({
        items: [{ id: 'ar-1' }],
        pageNumber: 1,
        pageSize: 20,
        totalCount: 1,
        totalPages: 1,
      });
      expect(reports.page).toHaveBeenCalledTimes(1);
      expect(reports.page).toHaveBeenCalledWith(where, 0, 20);
    });

    it('fills a page with open cases first, then closed ones', async () => {
      reports.page
        .mockResolvedValueOnce([[{ id: 'open-1' }], 1])
        .mockResolvedValueOnce([[{ id: 'closed-1' }], 3]);
      await expect(service.list({ pageSize: 2 })).resolves.toEqual({
        items: [{ id: 'open-1' }, { id: 'closed-1' }],
        pageNumber: 1,
        pageSize: 2,
        totalCount: 4,
        totalPages: 2,
      });
      expect(reports.page).toHaveBeenNthCalledWith(1, OPEN, 0, 2);
      expect(reports.page).toHaveBeenNthCalledWith(2, DONE, 0, 1);
    });

    it('starts the closed group where the open one ends on a later page', async () => {
      reports.page.mockResolvedValueOnce([[], 3]).mockResolvedValueOnce([[{ id: 'closed-2' }], 2]);
      const page = await service.list({ pageNumber: 3, pageSize: 2 });
      expect(page.items).toEqual([{ id: 'closed-2' }]);
      expect(reports.page).toHaveBeenNthCalledWith(1, OPEN, 4, 2);
      expect(reports.page).toHaveBeenNthCalledWith(2, DONE, 1, 2);
    });

    it('refuses a page size over MAX_PAGE_SIZE', async () => {
      await expectError(
        service.list({ pageSize: 101 }),
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_FAILED,
      );
      expect(reports.page).not.toHaveBeenCalled();
    });
  });
});
