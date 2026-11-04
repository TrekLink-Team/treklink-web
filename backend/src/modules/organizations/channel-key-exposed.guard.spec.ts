import { ErrorCode } from '../../common/errors';
import { OrganizationsRepository } from './organizations.repository';
import { OrganizationsService } from './organizations.service';

const ORG_ID = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const TX = { tx: true } as never;

// REQ-ERR-19: provisioning a unit with the channel key (rentals api-design 09 and 15) asks the
// organization first, and a key flagged exposed is refused.
describe('OrganizationsService.requireKeyNotExposed (REQ-ERR-19)', () => {
  let organizations: { channelKeyState: jest.Mock };
  let service: OrganizationsService;

  beforeEach(() => {
    organizations = { channelKeyState: jest.fn() };
    service = new OrganizationsService(
      organizations as unknown as OrganizationsRepository,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  it('passes while the key is not flagged exposed, reading in the caller transaction', async () => {
    organizations.channelKeyState.mockResolvedValue({
      channelKeyVersion: 2,
      channelKeyExposedAt: null,
    });
    await expect(service.requireKeyNotExposed(ORG_ID, TX)).resolves.toBeUndefined();
    expect(organizations.channelKeyState).toHaveBeenCalledWith(ORG_ID, TX);
  });

  it('refuses a key flagged exposed with 409 CHANNEL_KEY_EXPOSED and the rotation message', async () => {
    organizations.channelKeyState.mockResolvedValue({
      channelKeyVersion: 2,
      channelKeyExposedAt: new Date('2026-11-03T03:00:00.000Z'),
    });
    await expect(service.requireKeyNotExposed(ORG_ID)).rejects.toMatchObject({
      errorCode: ErrorCode.CHANNEL_KEY_EXPOSED,
      message: "The organization's channel key is exposed. Rotate it before writing it to a unit.",
    });
  });

  it('answers 404 for an unknown organization', async () => {
    organizations.channelKeyState.mockResolvedValue(null);
    await expect(service.requireKeyNotExposed(ORG_ID)).rejects.toMatchObject({
      errorCode: ErrorCode.NOT_FOUND,
    });
  });
});
