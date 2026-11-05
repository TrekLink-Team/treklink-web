import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface Envelope {
  result: { cursor?: number; devices?: { assetTag: string }[]; errorCode?: string };
  isSuccess: boolean;
  statusCode: number;
}

// Monitoring task 3.2 and organizations AC-05 (E04-5) over HTTP: the whole application serves the
// organization API on PostgreSQL, a Manager creates and revokes keys through the real routes, and the
// calls carry `X-Api-Key`. `api-keys.db-spec.ts` covers the same keys without HTTP. Every fixture is a
// fresh organization; nothing existing is deleted. Each case uses its own keys, so the per-key
// rate-limit window of one case never counts for another.
describe('organization API over HTTP (monitoring 3.2, organizations AC-05)', () => {
  let flow: RentalFlow;

  beforeAll(async () => {
    flow = await compileRentalFlow({ http: true });
  }, 120_000);
  afterAll(async () => {
    await flow?.close();
  });

  const createKey = async (org: Awaited<ReturnType<RentalFlow['organization']>>, name: string) => {
    const response = await flow.send(org.manager, 'post', `/api/organizations/${org.id}/api-keys`, {
      name,
    });
    expect(response.status).toBe(201);
    const created = (response.body as { result: { id: string; key: string } }).result;
    return { id: created.id, key: created.key };
  };
  const revokeKey = async (org: Awaited<ReturnType<RentalFlow['organization']>>, keyId: string) => {
    const response = await flow.send(
      org.manager,
      'post',
      `/api/organizations/${org.id}/api-keys/${keyId}/revoke`,
    );
    expect(response.status).toBeLessThan(300);
  };

  it('works with a created key and returns 401 after the key is revoked (AC-05)', async () => {
    const org = await flow.organization();
    const first = await createKey(org, 'first');
    const second = await createKey(org, 'second');

    const before = await flow.sendKey(first.key, '/api/telemetry/devices');
    expect(before.status).toBe(200);
    expect((before.body as Envelope).isSuccess).toBe(true);

    await revokeKey(org, first.id);

    const after = await flow.sendKey(first.key, '/api/telemetry/devices');
    expect(after.status).toBe(401);
    expect((after.body as Envelope).result.errorCode).toBe('UNAUTHENTICATED');
    expect((await flow.sendKey(second.key, '/api/telemetry/devices')).status).toBe(200);
  });

  it('refuses a key that was never issued and an empty key', async () => {
    const unknown = await flow.sendKey('tlk_not-a-real-key', '/api/telemetry/devices');
    expect(unknown.status).toBe(401);
    expect((unknown.body as Envelope).result.errorCode).toBe('UNAUTHENTICATED');
    expect((await flow.sendKey('', '/api/telemetry/devices')).status).toBe(401);
  });

  it('answers 429 RATE_LIMITED to the request after the limit of the minute', async () => {
    const org = await flow.organization();
    const { key } = await createKey(org, 'limited');
    const limit = Number(
      (await flow.seededParameters(['monitoring.apiRateLimitPerMinute']))[
        'monitoring.apiRateLimitPerMinute'
      ],
    );
    expect(limit).toBeGreaterThan(0);

    for (let call = 1; call <= limit; call++) {
      const response = await flow.sendKey(key, '/api/telemetry/devices');
      expect(response.status).toBe(200);
    }
    const refused = await flow.sendKey(key, '/api/telemetry/devices');

    expect(refused.status).toBe(429);
    expect((refused.body as Envelope).result.errorCode).toBe('RATE_LIMITED');
    // Another key of the same organization has its own window.
    const other = await createKey(org, 'other');
    expect((await flow.sendKey(other.key, '/api/telemetry/devices')).status).toBe(200);
  });

  it('refuses an access token on the organization API', async () => {
    const org = await flow.organization();
    const response = await flow.send(org.manager, 'get', '/api/telemetry/devices');
    expect(response.status).toBe(403);
  });

  it('serves the stream page of a key and asks for `after`', async () => {
    const org = await flow.organization();
    const { key } = await createKey(org, 'stream');

    const page = await flow.sendKey(key, '/api/telemetry/stream?after=0');
    expect(page.status).toBe(200);
    const missing = await flow.sendKey(key, '/api/telemetry/stream');
    expect(missing.status).toBe(400);
  });

  it('shows a key only the units its own organization holds', async () => {
    const holder = await flow.rented(1);
    const outsider = await flow.organization();
    const holderKey = await createKey(holder.org, 'holder');
    const outsiderKey = await createKey(outsider, 'outsider');

    const own = await flow.sendKey(holderKey.key, '/api/telemetry/devices');
    expect(own.status).toBe(200);
    expect((own.body as Envelope).result.devices?.map((device) => device.assetTag)).toEqual(
      holder.tags,
    );
    const foreign = await flow.sendKey(outsiderKey.key, '/api/telemetry/devices');
    expect(foreign.status).toBe(200);
    expect((foreign.body as Envelope).result.devices).toEqual([]);
  });
});
