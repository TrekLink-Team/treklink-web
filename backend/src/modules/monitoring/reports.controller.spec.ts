import { CHECK_POLICIES_KEY } from '../../common/decorators/access.decorator';
import { ReportsController } from './reports.controller';
import { ReportQueryDto, ReportsService, type ReportView } from './reports.service';

describe('ReportsController', () => {
  const report = { kind: 'revenue', from: '2026-10-01', to: '2026-11-01', rows: [] } as ReportView;
  const query = Object.assign(new ReportQueryDto(), {
    from: new Date('2026-10-01T00:00:00.000Z'),
    to: new Date('2026-11-01T00:00:00.000Z'),
  });
  const build = () => {
    const service = {
      report: jest.fn().mockResolvedValue(report),
      csv: jest.fn().mockReturnValue('variant\n'),
    };
    return { service, controller: new ReportsController(service as unknown as ReportsService) };
  };

  it('serves the JSON report of the service by default', async () => {
    const { service, controller } = build();
    await expect(controller.get({ kind: 'revenue' }, query)).resolves.toBe(report);
    expect(service.report).toHaveBeenCalledWith('revenue', query);
    expect(service.csv).not.toHaveBeenCalled();
  });

  it('serves the CSV text for format=csv', async () => {
    const { service, controller } = build();
    query.format = 'csv';
    await expect(controller.get({ kind: 'revenue' }, query)).resolves.toBe('variant\n');
    expect(service.csv).toHaveBeenCalledWith(report);
    query.format = undefined;
  });

  it('requires the report.read permission: Staff and Admin pass and anyone else does not', () => {
    type Policy = (ability: { can: (...args: unknown[]) => boolean }) => boolean;
    const handler: unknown = Object.getOwnPropertyDescriptor(
      ReportsController.prototype,
      'get',
    )?.value;
    const policies = (Reflect.getMetadata(CHECK_POLICIES_KEY, handler as object) as Policy[]) ?? [];
    expect(policies).toHaveLength(1);
    const asks: unknown[][] = [];
    const ability = (allowed: boolean) => ({
      can: (...args: unknown[]) => {
        asks.push(args);
        return allowed;
      },
    });
    expect(policies[0](ability(true))).toBe(true);
    expect(policies[0](ability(false))).toBe(false);
    expect(asks[0]).toEqual(['read', 'Report']);
  });
});
