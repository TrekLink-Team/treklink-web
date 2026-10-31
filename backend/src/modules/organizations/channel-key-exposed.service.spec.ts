import { EventEmitter2 } from '@nestjs/event-emitter';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TransactionalEvents } from '../platform/events/emit-after-commit';
import { ChannelKeyService } from './channel-key.service';
import { ORGANIZATION_KEY_EXPOSED } from './organization-events';
import { OrganizationsRepository } from './organizations.repository';

const TX = { tx: true } as unknown as Prisma.TransactionClient;
const STAFF = { id: 'u-staff', roles: ['STAFF'], organizationId: null };
const ORG_ID = '5b1d2c0e-7f3a-4e21-9c8d-1a2b3c4d5e6f';
const AT = new Date('2026-10-31T03:00:00.000Z');

describe('ChannelKeyService.markKeyExposed (REQ-EVT-13, AC-11, D-045)', () => {
  let organizations: { lockById: jest.Mock; update: jest.Mock };
  let emitted: [string, Record<string, unknown>][];
  let service: ChannelKeyService;

  beforeEach(() => {
    organizations = {
      lockById: jest.fn().mockResolvedValue({
        id: ORG_ID,
        status: 'ACTIVE',
        version: 3,
        channelKeyExposedAt: null,
      }),
      update: jest.fn().mockResolvedValue({ id: ORG_ID, version: 4 }),
    };
    emitted = [];
    service = new ChannelKeyService(
      organizations as unknown as OrganizationsRepository,
      {
        emitAfterCommit: (name: string, payload: Record<string, unknown>) =>
          emitted.push([name, payload]),
      } as unknown as TransactionalEvents,
    );
  });

  it('sets the flag in the caller transaction and emits the notice and the audit after commit', async () => {
    await expect(service.markKeyExposed(ORG_ID, AT, STAFF, TX)).resolves.toBe(true);

    expect(organizations.lockById).toHaveBeenCalledWith(ORG_ID, TX);
    expect(organizations.update).toHaveBeenCalledWith(ORG_ID, 3, { channelKeyExposedAt: AT }, TX);
    expect(emitted).toEqual([
      [ORGANIZATION_KEY_EXPOSED, { organizationId: ORG_ID, at: AT }],
      [
        'audit.record',
        expect.objectContaining({
          actorId: 'u-staff',
          actorRoles: ['STAFF'],
          organizationId: ORG_ID,
          action: 'organization.keyExposed',
          before: { channelKeyExposedAt: null },
          after: { channelKeyExposedAt: AT },
        }),
      ],
    ]);
  });

  it('marks a SUSPENDED organization too, and records SYSTEM when there is no actor', async () => {
    organizations.lockById.mockResolvedValue({
      id: ORG_ID,
      status: 'SUSPENDED',
      version: 5,
      channelKeyExposedAt: null,
    });

    await expect(service.markKeyExposed(ORG_ID, AT, null, TX)).resolves.toBe(true);

    expect(emitted[1][1]).toMatchObject({ actorId: null, actorRoles: [] });
  });

  it('keeps the first time and tells nobody again while the flag is set', async () => {
    organizations.lockById.mockResolvedValue({
      id: ORG_ID,
      status: 'ACTIVE',
      version: 3,
      channelKeyExposedAt: new Date('2026-10-30T03:00:00.000Z'),
    });

    await expect(service.markKeyExposed(ORG_ID, AT, STAFF, TX)).resolves.toBe(false);

    expect(organizations.update).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('refuses an unknown organization with 404 and writes nothing', async () => {
    organizations.lockById.mockResolvedValue(null);

    await expect(service.markKeyExposed(ORG_ID, AT, STAFF, TX)).rejects.toMatchObject({
      errorCode: 'NOT_FOUND',
    });

    expect(organizations.update).not.toHaveBeenCalled();
    expect(emitted).toEqual([]);
  });

  it('refuses a write that did not happen with 409 and emits nothing', async () => {
    organizations.update.mockResolvedValue(null);

    await expect(service.markKeyExposed(ORG_ID, AT, STAFF, TX)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });

    expect(emitted).toEqual([]);
  });

  it('emits nothing when the caller transaction rolls back, and both events once it commits', async () => {
    const emitter = { emit: jest.fn() };
    const prisma = {
      $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(TX),
    };
    const real = new TransactionalEvents(
      prisma as unknown as PrismaService,
      emitter as unknown as EventEmitter2,
    );
    const withReal = new ChannelKeyService(
      organizations as unknown as OrganizationsRepository,
      real,
    );

    await expect(
      real.transaction(async (tx) => {
        await withReal.markKeyExposed(ORG_ID, AT, STAFF, tx);
        throw new Error('the caller failed after the flag was set');
      }),
    ).rejects.toThrow('the caller failed');
    expect(emitter.emit).not.toHaveBeenCalled();

    await real.transaction((tx) => withReal.markKeyExposed(ORG_ID, AT, STAFF, tx));
    expect(emitter.emit.mock.calls.map(([name]: [string]) => name)).toEqual([
      ORGANIZATION_KEY_EXPOSED,
      'audit.record',
    ]);
  });
});
