import { CHECK_POLICIES_KEY } from '../../common/decorators/access.decorator';
import { SystemHealthController } from './system-health.controller';
import { SystemHealthService, SystemHealthView } from './system-health.service';

describe('SystemHealthController', () => {
  it('serves the report of the service for the query', async () => {
    const view = { devicesBuffering: 2 } as SystemHealthView;
    const service = { report: jest.fn().mockResolvedValue(view) };
    const controller = new SystemHealthController(service as unknown as SystemHealthService);
    await expect(controller.report({ windowMinutes: 30 })).resolves.toBe(view);
    expect(service.report).toHaveBeenCalledWith({ windowMinutes: 30 });
  });

  it('requires the systemHealth.read permission: an Admin passes and anyone else does not', () => {
    type Policy = (ability: { can: (...args: unknown[]) => boolean }) => boolean;
    const handler: unknown = Object.getOwnPropertyDescriptor(
      SystemHealthController.prototype,
      'report',
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
    expect(asks[0]).toEqual(['read', 'SystemHealth']);
  });
});
