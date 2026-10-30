import { createMongoAbility } from '@casl/ability';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { RESPONSE_MESSAGE_KEY } from '../../common/decorators/response-message.decorator';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

const CONFIG = {
  get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
} as never;

const metadataOf = (key: string, method: string): unknown =>
  Reflect.getMetadata(
    key,
    Object.getOwnPropertyDescriptor(MaintenanceController.prototype, method)?.value as object,
  );

const allows = (method: string, ability: PolicyAbility): boolean =>
  (metadataOf(CHECK_POLICIES_KEY, method) as PolicyHandler[]).every((handler) => handler(ability));

const ability = (rules: { action: string; subject: string }[]) =>
  createMongoAbility(rules) as PolicyAbility;
const READ = ability([{ action: 'read', subject: 'Device' }]);
const OPERATE = ability([
  { action: 'read', subject: 'Device' },
  { action: 'operate', subject: 'Device' },
]);
const DECIDE = ability([{ action: 'decide', subject: 'MaintenanceRecord' }]);
const NONE = ability([]);
const CALLER = { id: 'staff-1', roles: ['STAFF'], organizationId: null };

describe('MaintenanceController list (devices api-design 15)', () => {
  let maintenance: { page: jest.Mock; approvalThresholdVnd: jest.Mock };
  let controller: MaintenanceController;

  beforeEach(() => {
    maintenance = {
      page: jest.fn().mockResolvedValue([[{ id: 'm-1' }], 1]),
      approvalThresholdVnd: jest.fn().mockResolvedValue(1_000_000),
    };
    controller = new MaintenanceController(
      maintenance as unknown as MaintenanceService,
      { transaction: jest.fn() } as never,
      CONFIG,
    );
  });

  it('returns the page with the approval threshold from the parameters', async () => {
    await expect(controller.list({ status: ['OPEN'] })).resolves.toEqual({
      items: [{ id: 'm-1' }],
      pageNumber: 1,
      pageSize: 20,
      totalCount: 1,
      totalPages: 1,
      approvalThresholdVnd: 1_000_000,
    });
    expect(maintenance.approvalThresholdVnd).toHaveBeenCalledTimes(1);
  });

  it('filters records on their expected date when dueBefore is given, nothing else', async () => {
    await controller.list({ dueBefore: '2026-11-01' });
    const [[filter, skip, take]] = maintenance.page.mock.calls as [
      [{ statuses?: string[]; reasons?: string[]; expectedBy: Date }, number, number],
    ];
    expect(filter.statuses).toBeUndefined();
    expect(filter.reasons).toBeUndefined();
    expect(filter.expectedBy.toISOString().slice(0, 10)).toBe('2026-11-01');
    expect([skip, take]).toEqual([0, 20]);
  });

  it('lets Staff read the list with device.read only', () => {
    const staff = createMongoAbility([{ action: 'read', subject: 'Device' }]) as PolicyAbility;
    expect(allows('list', staff)).toBe(true);
    expect(allows('list', createMongoAbility([]) as PolicyAbility)).toBe(false);
  });
});

describe('MaintenanceController policies and messages (devices api-design 11 to 15)', () => {
  it.each([
    ['open', 'Maintenance opened'],
    ['estimate', 'Estimate recorded'],
    ['decide', 'Maintenance cost decided'],
    ['complete', 'Maintenance updated'],
    ['list', 'OK'],
  ])('%s answers the api-design message "%s"', (method, message) => {
    expect(metadataOf(RESPONSE_MESSAGE_KEY, method)).toBe(message);
  });

  it.each(['open', 'estimate', 'complete'])('%s needs device.operate', (method) => {
    expect(allows(method, OPERATE)).toBe(true);
    expect(allows(method, READ)).toBe(false);
    expect(allows(method, DECIDE)).toBe(false);
    expect(allows(method, NONE)).toBe(false);
  });

  it('decide needs maintenance.decide, which device.operate does not give', () => {
    expect(allows('decide', DECIDE)).toBe(true);
    expect(allows('decide', OPERATE)).toBe(false);
    expect(allows('decide', NONE)).toBe(false);
  });

  it('list needs device.read only', () => {
    expect(allows('list', READ)).toBe(true);
    expect(allows('list', NONE)).toBe(false);
  });

  it('runs each mutation inside one transaction with the caller as actor', async () => {
    const tx = { tx: true };
    const maintenance = {
      open: jest.fn().mockResolvedValue({}),
      estimate: jest.fn().mockResolvedValue({}),
      decide: jest.fn().mockResolvedValue({}),
      complete: jest.fn().mockResolvedValue({}),
    };
    const events = { transaction: jest.fn((cb: (client: object) => unknown) => cb(tx)) };
    const controller = new MaintenanceController(
      maintenance as unknown as MaintenanceService,
      events as never,
      CONFIG,
    );
    const body = {} as never;
    await controller.open('d-1', body, CALLER);
    await controller.estimate('d-1', 'm-1', body, CALLER);
    await controller.decide('d-1', 'm-1', body, CALLER);
    await controller.complete('d-1', 'm-1', body, CALLER);
    expect(events.transaction).toHaveBeenCalledTimes(4);
    for (const mock of Object.values(maintenance)) {
      const args = mock.mock.calls[0] as unknown[];
      expect(args).toContain('staff-1');
      expect(args[args.length - 1]).toBe(tx);
    }
  });
});
