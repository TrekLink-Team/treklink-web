import { createMongoAbility } from '@casl/ability';
import { Reflector } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import {
  Caller,
  CHECK_POLICIES_KEY,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import {
  AuthorityReportListQueryDto,
  AuthorityReportsController,
  CloseCaseDto,
} from './authority-reports.controller';
import { AuthorityReportsService } from './authority-reports.service';

const STAFF: Caller = { id: 'staff-1', roles: ['STAFF'], organizationId: null };
const REPORT = '0b6c9f2e-4d1a-4c3b-9e8f-7a6b5c4d3e2f';

describe('AuthorityReportsController (incidents 6.1, api-design 09 and 11)', () => {
  let reports: { list: jest.Mock; closeCase: jest.Mock };
  let controller: AuthorityReportsController;

  beforeEach(() => {
    reports = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      closeCase: jest.fn().mockResolvedValue({ id: REPORT, incidentState: 'CLOSED' }),
    };
    controller = new AuthorityReportsController(reports as unknown as AuthorityReportsService);
  });

  it('passes the list query and the closure through', async () => {
    await expect(controller.list({ open: true })).resolves.toEqual({ items: [] });
    expect(reports.list).toHaveBeenCalledWith({ open: true });
    const body = { closedAt: new Date('2026-10-21T08:00:00Z'), note: 'Found safe' };
    await expect(controller.closeCase(REPORT, body, STAFF)).resolves.toEqual({
      id: REPORT,
      incidentState: 'CLOSED',
    });
    expect(reports.closeCase).toHaveBeenCalledWith(REPORT, body, STAFF);
  });

  it.each([
    ['list', 'read'],
    ['closeCase', 'manage'],
  ] as const)('%s needs %s AuthorityReport', (method, action) => {
    const handler = Object.getOwnPropertyDescriptor(AuthorityReportsController.prototype, method)
      ?.value as (...args: never[]) => unknown;
    const [policy] = new Reflector().get<PolicyHandler[]>(CHECK_POLICIES_KEY, handler);
    // `authorityReport.manage` is the only seeded permission on this subject (Staff and Admin).
    expect(policy(createMongoAbility([{ action: 'manage', subject: 'AuthorityReport' }]))).toBe(
      true,
    );
    expect(policy(createMongoAbility([{ action, subject: 'AuthorityReport' }]))).toBe(true);
    expect(policy(createMongoAbility([{ action: 'read', subject: 'Incident' }]))).toBe(false);
  });

  it('reads the open flag and the closure time', () => {
    expect(plainToInstance(AuthorityReportListQueryDto, { open: 'true' })).toMatchObject({
      open: true,
    });
    expect(plainToInstance(AuthorityReportListQueryDto, { open: 'false' })).toMatchObject({
      open: false,
    });
    expect(plainToInstance(AuthorityReportListQueryDto, { open: 'yes' })).toMatchObject({
      open: 'yes',
    });
    expect(plainToInstance(CloseCaseDto, { closedAt: '2026-10-21T08:00:00Z' })).toMatchObject({
      closedAt: new Date('2026-10-21T08:00:00Z'),
    });
  });
});
