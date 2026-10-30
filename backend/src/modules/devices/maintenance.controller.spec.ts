import { createMongoAbility } from '@casl/ability';
import {
  CHECK_POLICIES_KEY,
  PolicyAbility,
  PolicyHandler,
} from '../../common/decorators/access.decorator';
import { MaintenanceController } from './maintenance.controller';
import { MaintenanceService } from './maintenance.service';

const CONFIG = {
  get: jest.fn((key: string) => (key === 'DEFAULT_PAGE_SIZE' ? 20 : 100)),
} as never;

const allows = (method: string, ability: PolicyAbility): boolean =>
  (
    Reflect.getMetadata(
      CHECK_POLICIES_KEY,
      Object.getOwnPropertyDescriptor(MaintenanceController.prototype, method)?.value as object,
    ) as PolicyHandler[]
  ).every((handler) => handler(ability));

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
