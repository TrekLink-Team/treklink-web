import { CHECK_POLICIES_KEY, PolicyHandler } from '../../common/decorators/access.decorator';
import { ChannelKeyController } from './channel-key.controller';
import { ChannelKeyService } from './channel-key.service';

const ORG = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };

describe('ChannelKeyController (api-design 27)', () => {
  const channelKey = {
    rotate: jest
      .fn()
      .mockResolvedValue({ id: ORG, channelKeyVersion: 3, channelKeyExposedAt: null }),
  };
  const controller = new ChannelKeyController(channelKey as unknown as ChannelKeyService);

  it('hands the route to the service with trimmed reason and the caller', async () => {
    await controller.rotate(ORG, { reason: ' Device lost ', expectedVersion: 3 }, STAFF);
    expect(channelKey.rotate).toHaveBeenCalledWith(ORG, 'Device lost', 3, STAFF);
  });

  it('checks rotateKey on Organization', () => {
    const asked: [string, string][] = [];
    const ability = {
      can: (action: string, subject: string | object) => {
        asked.push([action, typeof subject === 'string' ? subject : 'object']);
        return true;
      },
    };
    const handler = Object.getOwnPropertyDescriptor(ChannelKeyController.prototype, 'rotate')!
      .value as object;
    (Reflect.getMetadata(CHECK_POLICIES_KEY, handler) as PolicyHandler[])[0](ability);
    expect(asked).toEqual([['rotateKey', 'Organization']]);
  });
});
