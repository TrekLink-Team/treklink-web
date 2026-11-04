import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { DomainException, ErrorCode } from '../../common/errors';
import { ValidatedEnvironment } from '../platform/config/environment-variables';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ChannelKeyService } from './channel-key.service';
import { OrganizationsRepository } from './organizations.repository';

const NO_CONFIG = { get: () => 'unused-master' } as unknown as ConfigService<
  ValidatedEnvironment,
  true
>;
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
      update: jest.fn().mockResolvedValue({
        id: ORG_ID,
        version: 4,
        channelKeyVersion: 3,
        channelKeyExposedAt: null,
      }),
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
      NO_CONFIG,
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
      organizations.lockById.mockResolvedValue({
        id: ORG_ID,
        status,
        version: 3,
        channelKeyVersion: 2,
      });
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

describe('ChannelKeyService.deriveKey (rentals api-design 21, devices design section 8.6)', () => {
  const MASTER = 'unit-test-master-secret-0123456789ab';
  const OTHER_ORG_ID = '9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b';
  let versions: Record<string, number | null>;
  let exposed: Record<string, Date | null>;
  let organizations: { channelKeyState: jest.Mock };
  let service: ChannelKeyService;

  beforeEach(() => {
    versions = { [ORG_ID]: 1, [OTHER_ORG_ID]: 1 };
    exposed = {};
    organizations = {
      channelKeyState: jest.fn((id: string) =>
        Promise.resolve(
          versions[id] == null
            ? null
            : { channelKeyVersion: versions[id], channelKeyExposedAt: exposed[id] ?? null },
        ),
      ),
    };
    service = new ChannelKeyService(
      organizations as unknown as OrganizationsRepository,
      {} as unknown as TransactionalEvents,
      { get: () => MASTER } as unknown as ConfigService<ValidatedEnvironment, true>,
    );
  });

  it('gives HKDF-SHA256 of the master, salted with the organization id, info by version, 32 bytes', async () => {
    // Fixed vectors, computed once with node:crypto hkdfSync outside this code.
    await expect(service.deriveKey(ORG_ID)).resolves.toEqual({
      keyHex: 'c5adba80f2560068944f08f56c5131474894662e286a3577d8e09694f1e75a7d',
      keyVersion: 1,
    });
    versions[ORG_ID] = 2;
    await expect(service.deriveKey(ORG_ID)).resolves.toEqual({
      keyHex: '4ade0c5276e04eb93a5476b266e294d0373e8bdd5a6bb005c1fac21547128272',
      keyVersion: 2,
    });
    await expect(service.deriveKey(OTHER_ORG_ID)).resolves.toMatchObject({
      keyHex: '91fc0188ac702420ef6001ce2ca2a73d18df23791006bb862b9e72547cc8b7bf',
    });
  });

  it('is deterministic per organization and version, and differs between organizations and versions', async () => {
    const first = await service.deriveKey(ORG_ID);
    await expect(service.deriveKey(ORG_ID)).resolves.toEqual(first);
    const other = await service.deriveKey(OTHER_ORG_ID);
    expect(other.keyHex).not.toBe(first.keyHex);
    versions[ORG_ID] = 2;
    expect((await service.deriveKey(ORG_ID)).keyHex).not.toBe(first.keyHex);
    expect(first.keyHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it('refuses a key flagged exposed (REQ-ERR-19) until the rotation clears the flag', async () => {
    exposed[ORG_ID] = new Date('2026-11-03T03:00:00.000Z');
    await expect(service.deriveKey(ORG_ID)).rejects.toMatchObject({
      errorCode: ErrorCode.CHANNEL_KEY_EXPOSED,
    });
    // The rotation raises the version and clears the flag: the key of the new version is issued.
    exposed[ORG_ID] = null;
    versions[ORG_ID] = 2;
    await expect(service.deriveKey(ORG_ID)).resolves.toMatchObject({ keyVersion: 2 });
    // Another organization is not affected.
    exposed[ORG_ID] = new Date('2026-11-03T03:00:00.000Z');
    await expect(service.deriveKey(OTHER_ORG_ID)).resolves.toMatchObject({ keyVersion: 1 });
  });

  it('reads the version in the caller transaction and answers 404 for an unknown organization', async () => {
    await service.deriveKey(ORG_ID, TX);
    expect(organizations.channelKeyState).toHaveBeenCalledWith(ORG_ID, TX);
    const error = await service.deriveKey('0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10').then(
      () => undefined,
      (thrown: unknown) => thrown,
    );
    expect(error).toBeInstanceOf(DomainException);
    expect(error).toMatchObject({ errorCode: ErrorCode.NOT_FOUND });
  });
});
