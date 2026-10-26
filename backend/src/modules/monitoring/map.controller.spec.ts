import { LiveMapService, MapConfigDto } from './live-map.service';
import { MapController } from './map.controller';

describe('MapController', () => {
  it('serves the map configuration of the service', async () => {
    const config = { provider: 'openstreetmap' } as MapConfigDto;
    const liveMap = { config: jest.fn().mockResolvedValue(config) };
    const controller = new MapController(liveMap as unknown as LiveMapService);
    await expect(controller.config()).resolves.toBe(config);
  });
});
