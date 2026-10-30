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
});
