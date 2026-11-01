import { bootE2e, E2eApp, envelope } from './e2e-callers';

// devices api-design 10 through the real HTTP pipeline, Prisma stubbed: the reset of a unit already
// reset since it became RETURNED answers the 409 ALREADY_RESET envelope (D-002, D-026), and nothing
// is written. The race of two counters runs on Postgres in `test/device-reset.db-spec.ts`.

const D = '0d3f6a2b-7e11-4c55-8f0a-2b1c9e7d4a10';
const returnedAt = new Date('2026-10-30T03:00:00Z');

describe('devices (e2e)', () => {
  let e2e: E2eApp;
  const created = jest.fn();

  beforeAll(async () => {
    const tx = {
      $queryRaw: () => Promise.resolve([{ id: D }]),
      device: {
        findUnique: () =>
          Promise.resolve({
            id: D,
            assetTag: 'TL-0042',
            hardwareVariantId: 'v-1',
            status: 'RETURNED',
            statusChangedAt: returnedAt,
            keyVersion: null,
            keyOrganizationId: null,
            version: 5,
          }),
      },
      deviceReset: {
        findFirst: () => Promise.resolve({ createdAt: new Date('2026-10-30T03:05:00Z') }),
        create: created,
      },
      // The custody read of the reset (CUSTODY_RESOLVER, design §2.1): the unit was checked in, so no
      // contract row is open now.
      contractDevice: {
        findFirst: () => Promise.resolve(null),
      },
    };
    e2e = await bootE2e({
      $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    });
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  it('answers a second reset of the same return with the 409 ALREADY_RESET envelope', async () => {
    const response = await e2e.send('staff-1', 'post', `/api/devices/${D}/reset`, {
      keyRemoved: true,
      nodeDbCleared: true,
      ownerCleared: true,
    });

    expect(response.status).toBe(409);
    expect(envelope(response)).toMatchObject({
      isSuccess: false,
      statusCode: 409,
      message: 'This device is already reset for this return.',
      result: { errorCode: 'ALREADY_RESET' },
    });
    expect(created).not.toHaveBeenCalled();
  });

  // devices api-design 08: the firmware edit over HTTP. The stubbed unit is at version 5.
  it('answers a firmware edit on an older version with the 409 STALE_VERSION envelope', async () => {
    const response = await e2e.send('staff-1', 'patch', `/api/devices/${D}`, {
      firmwareVersion: '2.7.19-treklink.4',
      expectedVersion: 4,
    });

    expect(response.status).toBe(409);
    expect(envelope(response)).toMatchObject({
      isSuccess: false,
      statusCode: 409,
      result: { errorCode: 'STALE_VERSION' },
    });
  });

  it('refuses the firmware edit to an Org Manager (403) and an identity field (400)', async () => {
    const manager = await e2e.send('manager-a', 'patch', `/api/devices/${D}`, {
      firmwareVersion: '2.7.19-treklink.4',
      expectedVersion: 5,
    });
    expect(manager.status).toBe(403);
    expect(envelope(manager)).toMatchObject({ result: { errorCode: 'FORBIDDEN' } });

    const identity = await e2e.send('staff-1', 'patch', `/api/devices/${D}`, {
      firmwareVersion: '2.7.19-treklink.4',
      assetTag: 'TL-9999',
      expectedVersion: 5,
    });
    expect(identity.status).toBe(400);
    expect(envelope(identity)).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
  });
});
