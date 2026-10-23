import { Logger } from '@nestjs/common';
import { runWithRequestContext } from '../../../common/context/request-context';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { AuditRecordEvent } from './audit-record.event';
import { AuditSinkListener } from './audit-sink.listener';
import { REDACTED } from './redact';

const baseEvent: AuditRecordEvent = {
  actorId: 'user-1',
  actorRoles: ['ORG_MANAGER'],
  organizationId: 'org-1',
  action: 'member.deactivate',
  subjectType: 'OrganizationMember',
  subjectId: 'member-1',
};

describe('AuditSinkListener', () => {
  let create: jest.Mock;
  let listener: AuditSinkListener;
  let errorLog: jest.SpyInstance;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    listener = new AuditSinkListener({ auditLog: { create } } as unknown as PrismaService);
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => errorLog.mockRestore());

  const persisted = () => (create.mock.calls[0] as [{ data: Record<string, unknown> }])[0].data;

  it('persists the organization id it is given (REQ-UBI-10, task 1.7)', async () => {
    await listener.record(baseEvent);

    expect(persisted()).toMatchObject({
      actorId: 'user-1',
      actorRoles: ['ORG_MANAGER'],
      organizationId: 'org-1',
      action: 'member.deactivate',
      subjectType: 'OrganizationMember',
      subjectId: 'member-1',
    });
  });

  it('persists a null organization id for a platform-wide action', async () => {
    await listener.record({ ...baseEvent, organizationId: null, actorRoles: ['TREKLINK_ADMIN'] });

    expect(persisted()).toMatchObject({ organizationId: null });
  });

  it('redacts before and after and serialises dates', async () => {
    await listener.record({
      ...baseEvent,
      before: { status: 'ACTIVE', passwordHash: 'h1' },
      after: { status: 'INACTIVE', at: new Date('2026-10-23T01:02:03.000Z') },
    });

    expect(persisted()).toMatchObject({
      before: { status: 'ACTIVE', passwordHash: REDACTED },
      after: { status: 'INACTIVE', at: '2026-10-23T01:02:03.000Z' },
    });
  });

  it('takes the request id from the request context when the event carries none', async () => {
    await runWithRequestContext({ requestId: 'demo-req-0004' }, () => listener.record(baseEvent));

    expect(persisted()).toMatchObject({ requestId: 'demo-req-0004' });
  });

  it('logs the whole redacted entry and does not throw when the insert fails (REQ-ERR-06)', async () => {
    create.mockRejectedValue(new Error('connection lost'));

    await expect(
      listener.record({ ...baseEvent, after: { mqttSecret: 's3cret', count: 10 } }),
    ).resolves.toBeUndefined();

    const [line] = errorLog.mock.calls[0] as [string];
    expect(line).toContain('connection lost');
    expect(line).toContain('"action":"member.deactivate"');
    expect(line).toContain('"organizationId":"org-1"');
    expect(line).not.toContain('s3cret');
  });

  it('logs an entry whose snapshot cannot be serialised instead of throwing', async () => {
    await expect(listener.record({ ...baseEvent, after: { count: 10n } })).resolves.toBeUndefined();

    expect(create).not.toHaveBeenCalled();
    const [line] = errorLog.mock.calls[0] as [string];
    expect(line).toContain('"count":"10"');
  });
});
