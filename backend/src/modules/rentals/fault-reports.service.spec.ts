import { Caller } from '../../common/decorators/access.decorator';
import { ErrorCode } from '../../common/errors';
import { DevicesService } from '../devices';
import { OrganizationsService } from '../organizations';
import { AUDIT_RECORD } from '../platform/audit/audit-record.event';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { DEVICE_FAULT_REPORTED } from './contract-notification.events';
import { FaultReportsRepository } from './fault-reports.repository';
import { FaultReportsService } from './fault-reports.service';

const OPERATOR: Caller = { id: 'op-1', roles: ['ORG_OPERATOR'], organizationId: 'org-a' };
const HANDED = new Date('2026-11-10T02:00:00Z');
const custody = (patch: Record<string, unknown> = {}) => ({
  id: 'row-1',
  handedOverAt: HANDED,
  checkedInAt: null,
  lostAt: null,
  releasedAt: null,
  replacedBy: null,
  faultReports: [] as { id: string }[],
  ...patch,
});

describe('FaultReportsService', () => {
  const tx = {};
  let reports: Record<'lockOwnContract' | 'latestCustody' | 'insert' | 'ofContract', jest.Mock>;
  let devices: { lockStatus: jest.Mock; assetTags: jest.Mock };
  let organizations: { assertCanUseRentalGroups: jest.Mock };
  let events: { transaction: jest.Mock; emitAfterCommit: jest.Mock };
  let service: FaultReportsService;

  beforeEach(() => {
    reports = {
      lockOwnContract: jest.fn().mockResolvedValue(true),
      latestCustody: jest.fn().mockResolvedValue(custody()),
      insert: jest
        .fn()
        .mockImplementation((data: Record<string, unknown>) =>
          Promise.resolve({ id: 'fault-1', resolvedAt: null, resolution: null, ...data }),
        ),
      ofContract: jest.fn(),
    };
    devices = { lockStatus: jest.fn().mockResolvedValue('RENTED'), assetTags: jest.fn() };
    organizations = { assertCanUseRentalGroups: jest.fn().mockResolvedValue(undefined) };
    events = {
      transaction: jest.fn((work: (client: object) => Promise<unknown>) => work(tx)),
      emitAfterCommit: jest.fn(),
    };
    service = new FaultReportsService(
      reports as unknown as FaultReportsRepository,
      devices as unknown as DevicesService,
      organizations as unknown as OrganizationsService,
      events as unknown as TransactionalEvents,
    );
  });

  const report = (caller: Caller = OPERATOR) =>
    service.report('contract-1', 'dev-1', 'Screen cracked', caller);

  it('records a fault on a handed-over rented device and emits the notification and audit', async () => {
    const result = await report();
    expect(reports.lockOwnContract).toHaveBeenCalledWith('contract-1', 'org-a', tx);
    expect(devices.lockStatus).toHaveBeenCalledWith('dev-1', tx);
    expect(reports.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: 'contract-1',
        contractDeviceId: 'row-1',
        organizationId: 'org-a',
        deviceId: 'dev-1',
        reportedById: 'op-1',
      }),
      tx,
    );
    expect(result).toMatchObject({ id: 'fault-1', reportedBy: { id: 'op-1' }, resolution: null });
    expect(events.emitAfterCommit.mock.calls.map(([name]: [string]) => name)).toEqual([
      DEVICE_FAULT_REPORTED,
      AUDIT_RECORD,
    ]);
  });

  it('rejects a caller outside any organization before opening a transaction', async () => {
    await expect(
      report({ id: 'staff', roles: ['STAFF'], organizationId: null }),
    ).rejects.toMatchObject({ errorCode: ErrorCode.FORBIDDEN });
    expect(organizations.assertCanUseRentalGroups).not.toHaveBeenCalled();
    expect(events.transaction).not.toHaveBeenCalled();
  });

  it('propagates the organization capability refusal before opening a transaction', async () => {
    organizations.assertCanUseRentalGroups.mockRejectedValue(new Error('suspended'));
    await expect(report()).rejects.toThrow('suspended');
    expect(events.transaction).not.toHaveBeenCalled();
  });

  it('answers NOT_FOUND for another organization contract and for a device not on it', async () => {
    reports.lockOwnContract.mockResolvedValueOnce(false);
    await expect(report()).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
    expect(reports.latestCustody).not.toHaveBeenCalled();
    reports.latestCustody.mockResolvedValueOnce(null);
    await expect(report()).rejects.toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
    expect(reports.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['AVAILABLE', {}, 'AVAILABLE'],
    [null, {}, 'unavailable'],
    ['RENTED', { replacedBy: { id: 'row-2' } }, 'REPLACED'],
    ['RENTED', { checkedInAt: HANDED }, 'RETURNED'],
    ['RENTED', { lostAt: HANDED }, 'LOST'],
    ['RENTED', { releasedAt: HANDED }, 'RELEASED'],
    ['RENTED', { handedOverAt: null }, 'RESERVED'],
  ])('rejects a device in status %s with custody %j as %s', async (status, patch, state) => {
    devices.lockStatus.mockResolvedValue(status);
    reports.latestCustody.mockResolvedValue(custody(patch));
    await expect(report()).rejects.toMatchObject({
      errorCode: ErrorCode.INVALID_STATE_TRANSITION,
      message: `This cannot be done while it is ${state}.`,
    });
    expect(reports.insert).not.toHaveBeenCalled();
    expect(events.emitAfterCommit).not.toHaveBeenCalled();
  });

  it('rejects a second open fault on the same custody with the existing report id', async () => {
    reports.latestCustody.mockResolvedValue(custody({ faultReports: [{ id: 'fault-0' }] }));
    await expect(report()).rejects.toMatchObject({
      errorCode: ErrorCode.FAULT_ALREADY_REPORTED,
      resultDetails: { reportId: 'fault-0' },
    });
    expect(reports.insert).not.toHaveBeenCalled();
  });

  it('lists a contract faults with asset tags and answers NOT_FOUND outside the caller scope', async () => {
    reports.ofContract.mockResolvedValueOnce([
      { id: 'f-1', deviceId: 'dev-1' },
      { id: 'f-2', deviceId: 'dev-1' },
      { id: 'f-3', deviceId: 'dev-2' },
    ]);
    devices.assetTags.mockResolvedValue(new Map([['dev-1', 'TL-0001']]));
    await expect(service.ofContract('contract-1', OPERATOR)).resolves.toEqual([
      { id: 'f-1', deviceId: 'dev-1', assetTag: 'TL-0001' },
      { id: 'f-2', deviceId: 'dev-1', assetTag: 'TL-0001' },
      { id: 'f-3', deviceId: 'dev-2', assetTag: null },
    ]);
    expect(reports.ofContract).toHaveBeenCalledWith('contract-1', 'org-a');
    expect(devices.assetTags).toHaveBeenCalledWith(['dev-1', 'dev-2']);
    reports.ofContract.mockResolvedValueOnce(null);
    await expect(service.ofContract('contract-1', OPERATOR)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});
