import { createMongoAbility } from '@casl/ability';
import { HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthorityReport, Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { DomainException, ErrorCode } from '../../common/errors';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ContractsService } from '../rentals';
import { AuthorityReportsController, ContractReportDto } from './authority-reports.controller';
import { AuthorityReportsRepository } from './authority-reports.repository';
import { AuthorityReportsService } from './authority-reports.service';
import { IncidentLifecycle } from './incident-lifecycle';
import { IncidentsRepository } from './incidents.repository';

const STAFF: Caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const CONTRACT = 'c0ffee00-1234-4abc-9def-001122334455';
// api-design 10 sets no bound on reportedAt (screen 8.3 H-05), so a later time is accepted.
const INPUT = {
  contractId: CONTRACT,
  agency: ' District 1 police ',
  reference: 'PC-Q1-2026-338',
  reportedAt: new Date(Date.now() + 3_600_000),
  note: '  ',
};

const expectError = async (promise: Promise<unknown>, status: number, code: ErrorCode) => {
  const error: unknown = await promise.catch((caught: unknown) => caught);
  expect(error).toBeInstanceOf(DomainException);
  expect(error).toMatchObject({ errorCode: code });
  expect((error as DomainException).getStatus()).toBe(status);
  return error as DomainException;
};

describe('AuthorityReportsService.reportContract (api-design 10)', () => {
  const tx = { marker: 'tx' } as unknown as Prisma.TransactionClient;
  let insert: jest.Mock;
  let statusOf: jest.Mock;
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let lifecycle: { apply: jest.Mock };
  let service: AuthorityReportsService;

  beforeEach(() => {
    insert = jest.fn().mockImplementation((data: Partial<AuthorityReport>) =>
      Promise.resolve({
        id: 'ar-2',
        incidentId: null,
        caseClosedAt: null,
        reportedById: 'staff-1',
        createdAt: new Date(),
        caseClosedById: null,
        ...data,
      }),
    );
    statusOf = jest.fn().mockResolvedValue('DEFAULTED');
    lifecycle = { apply: jest.fn() };
    events = {
      transaction: jest.fn((work: (client: Prisma.TransactionClient) => unknown) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    service = new AuthorityReportsService(
      {} as IncidentsRepository,
      { insert } as unknown as AuthorityReportsRepository,
      lifecycle as unknown as IncidentLifecycle,
      events as unknown as TransactionalEvents,
      {} as ConfigService<ValidatedEnvironment, true>,
      { statusOf } as unknown as ContractsService,
    );
  });

  it('records the report on a DEFAULTED contract and changes no incident', async () => {
    await expect(service.reportContract(INPUT, STAFF)).resolves.toEqual({
      id: 'ar-2',
      incidentId: null,
      contractId: CONTRACT,
      agency: 'District 1 police',
      reference: 'PC-Q1-2026-338',
      reportedAt: INPUT.reportedAt,
      caseClosedAt: null,
    });
    expect(statusOf).toHaveBeenCalledWith(CONTRACT);
    expect(insert).toHaveBeenCalledWith(
      {
        contractId: CONTRACT,
        agency: 'District 1 police',
        reference: 'PC-Q1-2026-338',
        reportedAt: INPUT.reportedAt,
        reportedById: 'staff-1',
        note: undefined,
      },
      tx,
    );
    expect(lifecycle.apply).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).toHaveBeenCalledWith(
      AUDIT_RECORD,
      expect.objectContaining({ action: 'authority_report.create', subjectId: 'ar-2' }),
    );
  });

  it('answers 409 CONTRACT_NOT_DEFAULTED naming the status, and inserts nothing', async () => {
    statusOf.mockResolvedValue('OVERDUE');
    const error = await expectError(
      service.reportContract(INPUT, STAFF),
      HttpStatus.CONFLICT,
      ErrorCode.CONTRACT_NOT_DEFAULTED,
    );
    expect(error.message).toBe('This cannot be done while it is OVERDUE.');
    expect(insert).not.toHaveBeenCalled();
  });

  it('answers 404 for a missing contract', async () => {
    statusOf.mockResolvedValue(null);
    await expectError(
      service.reportContract(INPUT, STAFF),
      HttpStatus.NOT_FOUND,
      ErrorCode.NOT_FOUND,
    );
  });

  it('refuses a blank agency with 400 and an organization account with 403', async () => {
    await expectError(
      service.reportContract({ ...INPUT, agency: ' ' }, STAFF),
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_FAILED,
    );
    await expectError(
      service.reportContract(INPUT, { id: 'm-1', roles: ['ORG_MANAGER'], organizationId: 'org-a' }),
      HttpStatus.FORBIDDEN,
      ErrorCode.FORBIDDEN,
    );
    expect(statusOf).not.toHaveBeenCalled();
  });
});

describe('AuthorityReportsController.reportContract (api-design 10)', () => {
  it('passes the body through and needs manage AuthorityReport', async () => {
    const reportContract = jest.fn().mockResolvedValue({ id: 'ar-2' });
    const controller = new AuthorityReportsController({
      reportContract,
    } as unknown as AuthorityReportsService);
    const body = { ...INPUT, note: undefined };
    await expect(controller.reportContract(body, STAFF)).resolves.toEqual({ id: 'ar-2' });
    expect(reportContract).toHaveBeenCalledWith(body, STAFF);
    const handler = Object.getOwnPropertyDescriptor(
      AuthorityReportsController.prototype,
      'reportContract',
    )?.value as (...args: never[]) => unknown;
    const [policy] = new Reflector().get<PolicyHandler[]>(CHECK_POLICIES_KEY, handler);
    expect(policy(createMongoAbility([{ action: 'manage', subject: 'AuthorityReport' }]))).toBe(
      true,
    );
    expect(policy(createMongoAbility([{ action: 'read', subject: 'AuthorityReport' }]))).toBe(
      false,
    );
  });

  it('validates the body', async () => {
    const ok = plainToInstance(ContractReportDto, {
      contractId: CONTRACT,
      agency: 'a',
      reference: 'r',
      reportedAt: '2026-11-30T02:00:00Z',
    });
    expect(ok.reportedAt).toEqual(new Date('2026-11-30T02:00:00Z'));
    await expect(validate(ok)).resolves.toHaveLength(0);
    const bad = await validate(
      plainToInstance(ContractReportDto, {
        contractId: 'not-a-uuid',
        agency: 'x'.repeat(201),
        reference: '',
        reportedAt: 'soon',
      }),
    );
    expect(bad.map((error) => error.property).sort()).toEqual([
      'agency',
      'contractId',
      'reference',
      'reportedAt',
    ]);
  });
});
