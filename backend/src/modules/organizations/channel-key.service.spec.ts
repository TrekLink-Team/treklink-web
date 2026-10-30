import { Prisma } from '@prisma/client';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ChannelKeyService } from './channel-key.service';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ORG_ID = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';

describe('ChannelKeyService.rotate (api-design 27)', () => {
  let organizations: { lockById: jest.Mock; update: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: ChannelKeyService;

  beforeEach(() => {
    organizations = {
      lockById: jest
        .fn()
        .mockResolvedValue({ id: ORG_ID, status: 'ACTIVE', version: 3, channelKeyVersion: 2 }),
      update: jest
        .fn()
        .mockResolvedValue({ id: ORG_ID, version: 4, channelKeyVersion: 3, channelKeyExposedAt: null }),
    };
    emitted = [];
    const events = {
      transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
      emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
        emitted.push([name, payload]),
    };
    service = new ChannelKeyService(
      organizations as unknown as OrganizationsRepository,
      events as unknown as TransactionalEvents,
    );
  });

  it('increments channelKeyVersion, clears channelKeyExposedAt and audits the rotation', async () => {
    await expect(service.rotate(ORG_ID, 'Device lost', 3, STAFF)).resolves.toEqual({
      id: ORG_ID,
      channelKeyVersion: 3,
      channelKeyExposedAt: null,
    });
    expect(organizations.update).toHaveBeenCalledWith(
      ORG_ID,
      3,
      { channelKeyVersion: { increment: 1 }, channelKeyExposedAt: null },
      TX,
    );
    expect(emitted).toEqual([
      ['audit.record', expect.objectContaining({ action: 'organization.rotateKey' })],
    ]);
  });

  it('refuses an unknown organization with 404', async () => {
    organizations.lockById.mockResolvedValue(null);
    await expect(service.rotate(ORG_ID, 'reason', 3, STAFF)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });
  });

  it.each(['PENDING', 'REJECTED', 'CLOSED'])(
    'refuses a %s organization with 409 INVALID_STATE_TRANSITION',
    async (status) => {
      organizations.lockById.mockResolvedValue({ id: ORG_ID, status, version: 3, channelKeyVersion: 2 });
      await expect(service.rotate(ORG_ID, 'reason', 3, STAFF)).rejects.toMatchObject({
        errorCode: 'INVALID_STATE_TRANSITION',
      });
    },
  );

  it('allows rotation on a SUSPENDED organization', async () => {
    organizations.lockById.mockResolvedValue({
      id: ORG_ID,
      status: 'SUSPENDED',
      version: 3,
      channelKeyVersion: 2,
    });
    await expect(service.rotate(ORG_ID, 'reason', 3, STAFF)).resolves.toMatchObject({
      channelKeyVersion: 3,
    });
  });

  it('refuses a stale expectedVersion with 409 STALE_VERSION, and emits nothing', async () => {
    organizations.update.mockResolvedValue(null);
    await expect(service.rotate(ORG_ID, 'reason', 1, STAFF)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(emitted).toEqual([]);
  });
});
