import { LiveMapService, MapConfigDto, MapSnapshotDto } from './live-map.service';
import { MapController } from './map.controller';

describe('MapController', () => {
  it('serves the map configuration of the service', async () => {
    const config = { provider: 'openstreetmap' } as MapConfigDto;
    const liveMap = { config: jest.fn().mockResolvedValue(config) };
    const controller = new MapController(liveMap as unknown as LiveMapService);
    await expect(controller.config()).resolves.toBe(config);
  });

  it('passes the query, the caller and the ability to the snapshot', async () => {
    const snapshot = { cursor: 7, devices: [], fieldStations: [] } as MapSnapshotDto;
    const liveMap = { snapshot: jest.fn().mockResolvedValue(snapshot) };
    const controller = new MapController(liveMap as unknown as LiveMapService);
    const caller = { id: 'u-1', roles: ['ORG_OPERATOR'], organizationId: 'org-1' };
    const ability = { can: () => true };
    await expect(controller.snapshot({}, caller, ability)).resolves.toBe(snapshot);
    expect(liveMap.snapshot).toHaveBeenCalledWith({}, caller, ability);
  });
});
