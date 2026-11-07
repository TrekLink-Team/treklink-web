/* eslint-disable @typescript-eslint/require-await -- Promise-shaped service test doubles. */
import { DemoQuickProfileService, DEMO_PROFILE } from './demo-quick-profile.service';
import { DemoQuickRepository } from './demo-quick.repository';
import { ParameterService } from '../platform/parameters/parameter.service';
import { TransactionalEvents } from '../platform/events/emit-after-commit';

const actor = { id: 'admin', roles: ['ADMIN'], organizationId: null };
function fixture() {
  let state: { version: number; snapshot: unknown } = { version: 0, snapshot: null };
  const rows = Object.fromEntries(
    Object.keys(DEMO_PROFILE).map((key) => [
      key,
      { value: key.endsWith('Minutes') ? 30 : 120, version: 1 },
    ]),
  );
  const tx = {};
  const repository = {
    profile: jest.fn(async () => state),
    lockProfile: jest.fn(async () => state),
    saveProfile: jest.fn(
      async (_version: number, snapshot: unknown) =>
        (state = { version: state.version + 1, snapshot }),
    ),
  };
  const parameters = {
    row: jest.fn(async (key: string) => ({ ...rows[key] })),
    update: jest.fn(
      async (key: string, input: { value: number; expectedVersion: number }) =>
        (rows[key] = { value: input.value, version: input.expectedVersion + 1 }),
    ),
  };
  const events = {
    transaction: jest.fn(async (work: (tx: object) => Promise<unknown>) => {
      const before = structuredClone(rows);
      const saved = structuredClone(state);
      try {
        return await work(tx);
      } catch (error) {
        Object.assign(rows, before);
        state = saved;
        throw error;
      }
    }),
  };
  const service = new DemoQuickProfileService(
    repository as unknown as DemoQuickRepository,
    parameters as unknown as ParameterService,
    events as unknown as TransactionalEvents,
  );
  return { service, repository, parameters, rows, tx };
}

describe('DemoQuickProfileService', () => {
  it('persists old values, applies exact script values and restores after a new instance', async () => {
    const f = fixture();
    expect(await f.service.status()).toEqual({ active: false, version: 0 });
    expect(await f.service.change(true, 0, actor)).toEqual({ active: true, version: 1 });
    for (const [key, value] of Object.entries(DEMO_PROFILE)) expect(f.rows[key].value).toBe(value);
    expect(f.parameters.update).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ reason: 'Demo escalation profile enabled' }),
      actor,
      f.tx,
    );
    expect(await f.service.change(false, 1, actor)).toEqual({ active: false, version: 2 });
    for (const key of Object.keys(DEMO_PROFILE))
      expect(f.rows[key].value).toBe(key.endsWith('Minutes') ? 30 : 120);
  });
  it('rejects stale profile before changing parameters', async () => {
    const f = fixture();
    await expect(f.service.change(true, 9, actor)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(f.parameters.update).not.toHaveBeenCalled();
  });
  it('rolls back all changes when a parameter was edited during the profile', async () => {
    const f = fixture();
    await f.service.change(true, 0, actor);
    const key = Object.keys(DEMO_PROFILE)[2];
    f.rows[key] = { value: 90, version: 7 };
    await expect(f.service.change(false, 1, actor)).rejects.toMatchObject({
      errorCode: 'STALE_VERSION',
    });
    expect(f.rows[Object.keys(DEMO_PROFILE)[0]].value).toBe(30);
    expect(f.rows[key].value).toBe(90);
    expect(await f.service.status()).toEqual({ active: true, version: 1 });
  });
  it('is idempotent for the current state, but still checks its version', async () => {
    const f = fixture();
    expect(await f.service.change(false, 0, actor)).toEqual({ active: false, version: 0 });
    expect(f.parameters.update).not.toHaveBeenCalled();
  });
  it('reports missing migrated parameter and rolls back', async () => {
    const f = fixture();
    f.parameters.row.mockResolvedValueOnce(null as never);
    await expect(f.service.change(true, 0, actor)).rejects.toMatchObject({
      errorCode: 'DEMO_SEED_NOT_CONFIGURED',
    });
  });
});
