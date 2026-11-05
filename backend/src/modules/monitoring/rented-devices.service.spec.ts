import type { ConfigService } from '@nestjs/config';
import { LossCaseState } from '@prisma/client';
import type { Caller } from '../../common/decorators/access.decorator';
import type { DevicesService, LossCaseService } from '../devices';
import type { ValidatedEnvironment } from '../platform/config/environment-variables';
import type { ParameterService } from '../platform/parameters/parameter.service';
import type { ContractsService, GroupsService } from '../rentals';
import { RentedDevicesService } from './rented-devices.service';

const NOW = new Date('2026-11-05T06:00:00.000Z');
const HANDED_OVER = new Date('2026-11-05T05:00:00.000Z');
const PREVIOUS_READING = new Date('2026-11-05T04:00:00.000Z');
const MANAGER: Caller = { id: 'manager', roles: ['ORG_MANAGER'], organizationId: 'org-1' };

describe('RentedDevicesService', () => {
  it('clips prior-custody readings and reads loss cases by paged custody ID', async () => {
    const device = {
      id: 'd-1',
      assetTag: 'TL-0001',
      variantCode: 'treklink-v3',
      lastSeenAt: PREVIOUS_READING,
      lastBatteryAt: PREVIOUS_READING,
      batteryPct: 82,
      lastLatitude: null,
      lastLongitude: null,
      lastPositionAt: null,
    };
    const custody = {
      deviceId: device.id,
      contractDeviceId: 'cd-1',
      contractId: 'c-1',
      contractCode: 'RC-2026-0001',
      organizationId: MANAGER.organizationId,
      planType: 'FIXED_TERM',
      contractStatus: 'ACTIVE',
      handedOverAt: HANDED_OVER,
      group: { id: 'g-1', name: 'A', parentId: null },
      holder: { name: 'Le Thi A' },
      openFaultReportId: 'fault-1',
    };
    const loss = { id: 'loss-1', code: 'LOSS-001', state: LossCaseState.SEARCHING };
    const visibleDevices = jest.fn().mockResolvedValue([custody]);
    const summariesOfContractDevices = jest.fn().mockResolvedValue(new Map([['cd-1', loss]]));
    const service = new RentedDevicesService(
      { visibleDevices } as unknown as ContractsService,
      {} as GroupsService,
      { projections: jest.fn().mockResolvedValue([device]) } as unknown as DevicesService,
      { summariesOfContractDevices } as unknown as LossCaseService,
      { get: jest.fn().mockResolvedValue(300) } as unknown as ParameterService,
      { get: jest.fn().mockReturnValue(10) } as unknown as ConfigService<
        ValidatedEnvironment,
        true
      >,
    );

    const page = await service.list({ state: 'NOT_HEARD' }, MANAGER, NOW);

    expect(visibleDevices).toHaveBeenCalledWith({ organizationId: MANAGER.organizationId });
    expect(summariesOfContractDevices).toHaveBeenCalledWith(['cd-1']);
    expect(page.totalCount).toBe(1);
    expect(page.items).toEqual([
      {
        deviceId: 'd-1',
        assetTag: 'TL-0001',
        variantCode: 'treklink-v3',
        contract: { id: 'c-1', code: 'RC-2026-0001', planType: 'FIXED_TERM', status: 'ACTIVE' },
        contractDeviceId: 'cd-1',
        handedOverAt: HANDED_OVER.toISOString(),
        state: 'NOT_HEARD',
        batteryPct: null,
        lastSeenAt: null,
        group: custody.group,
        holder: custody.holder,
        openFaultReportId: 'fault-1',
        openLossCase: loss,
      },
    ]);
  });
});
