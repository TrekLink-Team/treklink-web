import type { ContractsService, VisibleDevice } from '../rentals';
import { incidentDeviceGroups } from './incident-device-groups';

describe('incidentDeviceGroups tenant boundaries', () => {
  const group = { id: 'g-a', name: 'North trail' };
  let visibleDevices: jest.Mock;
  let contracts: ContractsService;

  beforeEach(() => {
    visibleDevices = jest.fn().mockResolvedValue([]);
    contracts = { visibleDevices } as unknown as ContractsService;
  });

  it.each([{ incidents: [] }, { incidents: [{ deviceId: 'd-1', organizationId: null }] }])(
    'does not read rental groups without a routed device: %j',
    async ({ incidents }) => {
      await expect(incidentDeviceGroups(contracts, incidents)).resolves.toEqual(new Map());
      expect(visibleDevices).not.toHaveBeenCalled();
    },
  );

  it('deduplicates device reads and attaches only the group in the routed organization', async () => {
    visibleDevices.mockResolvedValue([
      { deviceId: 'd-1', organizationId: 'org-b', group: { id: 'g-b', name: 'Other tenant' } },
      { deviceId: 'd-2', organizationId: 'org-a', group: null },
      { deviceId: 'd-1', organizationId: 'org-a', group },
    ] as VisibleDevice[]);
    await expect(
      incidentDeviceGroups(contracts, [
        { deviceId: 'd-1', organizationId: 'org-a' },
        { deviceId: 'd-1', organizationId: 'org-a' },
        { deviceId: 'd-2', organizationId: 'org-a' },
        { deviceId: 'unrouted', organizationId: null },
      ]),
    ).resolves.toEqual(new Map([['org-a:d-1', group]]));
    expect(visibleDevices).toHaveBeenCalledWith({
      organizationId: null,
      deviceIds: ['d-1', 'd-2'],
    });
  });
});
