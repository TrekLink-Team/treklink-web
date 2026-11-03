import { RentalsDeviceContracts } from './device-contracts.provider';

describe('RentalsDeviceContracts (DEVICE_CONTRACTS)', () => {
  it('maps the live rows with the organization code and asks nothing for no device', async () => {
    const contracts = {
      liveContractsOfDevices: jest.fn().mockResolvedValue([
        {
          deviceId: 'd-42',
          contract: {
            id: 'c-1',
            code: 'RC-2026-0042',
            status: 'APPROVED',
            organizationId: 'org-7',
          },
        },
      ]),
    };
    const organizations = {
      labelsOf: jest
        .fn()
        .mockResolvedValue(new Map([['org-7', { id: 'org-7', code: 'ORG-0007' }]])),
    };
    const port = new RentalsDeviceContracts(contracts as never, organizations as never);

    await expect(port.liveContractsOf([])).resolves.toEqual([]);
    expect(contracts.liveContractsOfDevices).not.toHaveBeenCalled();

    await expect(port.liveContractsOf(['d-42'])).resolves.toEqual([
      {
        deviceId: 'd-42',
        contractId: 'c-1',
        code: 'RC-2026-0042',
        status: 'APPROVED',
        organizationId: 'org-7',
        organizationCode: 'ORG-0007',
      },
    ]);
  });
});
