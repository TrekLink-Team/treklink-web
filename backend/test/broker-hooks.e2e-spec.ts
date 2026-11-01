import * as bcrypt from 'bcrypt';
import * as request from 'supertest';
import type { E2eApp } from './e2e-callers';

// gateway-sync api-design 01 and 02 (task 3.1) through the real HTTP pipeline, Prisma stubbed: the
// global JWT guard lets the broker through (no token), MQTT_AUTH_HOOK_SECRET gates both routes before
// body validation, and every answer is the D-002 envelope that go-auth's status mode reads (200
// allows, 401 and 403 deny). With the variable unset the routes answer 404. ConfigModule validates
// the environment when AppModule is imported, so each app is required after its environment is set.

const HOOK_SECRET = 'e2e-broker-hook-secret-0123';
const STATION = 'fs-org-0001-1';
const STATION_SECRET = 'fs_e2e_station_secret';

type Boot = (tables: Record<string, unknown>) => Promise<E2eApp>;

const SAVED = ['MQTT_AUTH_HOOK_SECRET', 'MQTT_USERNAME', 'MQTT_PASSWORD', 'MQTT_NODE_PASSWORD'].map(
  (name) => [name, process.env[name]] as const,
);
afterAll(() => {
  for (const [name, value] of SAVED) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const bootWith = (secret: string | undefined, tables: Record<string, unknown>): Promise<E2eApp> => {
  let boot: Boot | undefined;
  if (secret === undefined) delete process.env.MQTT_AUTH_HOOK_SECRET;
  else process.env.MQTT_AUTH_HOOK_SECRET = secret;
  process.env.MQTT_USERNAME = 'treklink-backend';
  process.env.MQTT_PASSWORD = 'e2e-backend-password';
  process.env.MQTT_NODE_PASSWORD = 'e2e-fleet-node-password';
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    boot = (require('./e2e-callers') as { bootE2e: Boot }).bootE2e;
  });
  return (boot as Boot)(tables);
};

const body = (response: request.Response) =>
  response.body as {
    result: { allowed?: boolean; kind?: string; errorCode?: string } | null;
    isSuccess: boolean;
    statusCode: number;
    message: string;
  };

describe('broker hooks behind MQTT_AUTH_HOOK_SECRET (e2e)', () => {
  let e2e: E2eApp;
  const findUnique = jest.fn();
  let station: Record<string, unknown>;

  beforeAll(async () => {
    station = {
      id: 'fs-1',
      organizationId: 'org-a',
      mqttUsername: STATION,
      secretHash: await bcrypt.hash(STATION_SECRET, 4),
      revokedAt: null,
      organization: { status: 'ACTIVE' },
    };
    e2e = await bootWith(HOOK_SECRET, { fieldStation: { findUnique } });
  });

  beforeEach(() => {
    findUnique.mockReset();
    findUnique.mockResolvedValue(station);
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  const post = (path: string, payload: object, secret: string | null = HOOK_SECRET) => {
    const call = request(e2e.app.getHttpServer()).post(path);
    return (secret === null ? call : call.set('X-Broker-Secret', secret)).send(payload);
  };

  it('allows an active Field Station with its secret: 200 envelope with its kind', async () => {
    const response = await post('/api/internal/mqtt/user', {
      username: STATION,
      password: STATION_SECRET,
      clientid: 'fieldstation-1',
    });
    expect(response.status).toBe(200);
    expect(body(response)).toEqual({
      result: { allowed: true, kind: 'FIELD_STATION' },
      isSuccess: true,
      statusCode: 200,
      message: 'OK',
    });
  });

  it('refuses a revoked station with 403 CREDENTIAL_REJECTED (organizations AC-06)', async () => {
    findUnique.mockResolvedValue({ ...station, revokedAt: new Date('2026-11-01T00:00:00Z') });
    const response = await post('/api/internal/mqtt/user', {
      username: STATION,
      password: STATION_SECRET,
      clientid: 'fieldstation-1',
    });
    expect(response.status).toBe(403);
    expect(body(response)).toMatchObject({
      result: { errorCode: 'CREDENTIAL_REJECTED' },
      isSuccess: false,
      statusCode: 403,
    });
  });

  it('allows a fleet node with the shared MQTT_NODE_PASSWORD and refuses a wrong one', async () => {
    const allowed = await post('/api/internal/mqtt/user', {
      username: 'node-!a4b1c2d3',
      password: 'e2e-fleet-node-password',
      clientid: 'node-a4b1c2d3',
    });
    expect(allowed.status).toBe(200);
    expect(body(allowed).result).toEqual({ allowed: true, kind: 'FLEET_NODE' });

    const refused = await post('/api/internal/mqtt/user', {
      username: 'node-!a4b1c2d3',
      password: 'not-the-node-password',
      clientid: 'node-a4b1c2d3',
    });
    expect(refused.status).toBe(403);
    expect(body(refused)).toMatchObject({ result: { errorCode: 'CREDENTIAL_REJECTED' } });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows the backend subscriber with MQTT_PASSWORD', async () => {
    const response = await post('/api/internal/mqtt/user', {
      username: 'treklink-backend',
      password: 'e2e-backend-password',
      clientid: 'treklink-backend-service',
    });
    expect(response.status).toBe(200);
    expect(body(response).result).toEqual({ allowed: true, kind: 'BACKEND' });
    expect(findUnique).not.toHaveBeenCalled();
  });

  it('allows a station publish under its own topic and denies another station with 403 TOPIC_DENIED', async () => {
    const allowed = await post('/api/internal/mqtt/acl', {
      username: STATION,
      clientid: 'fieldstation-1',
      topic: `treklink/fs/${STATION}/2/json/LongFast/!a4b1c2d3`,
      acc: 2,
    });
    expect(allowed.status).toBe(200);
    expect(body(allowed)).toMatchObject({ result: { allowed: true }, isSuccess: true });

    const denied = await post('/api/internal/mqtt/acl', {
      username: STATION,
      clientid: 'fieldstation-1',
      topic: 'treklink/fs/fs-org-0002-1/health',
      acc: 2,
    });
    expect(denied.status).toBe(403);
    expect(body(denied)).toMatchObject({ result: { errorCode: 'TOPIC_DENIED' }, isSuccess: false });
  });

  it.each([
    ['missing', null],
    ['wrong', 'e2e-broker-hook-secret-WRONG'],
  ])(
    'answers 401 BROKER_SECRET when the secret is %s, before validating the body',
    async (_label, secret) => {
      for (const path of ['/api/internal/mqtt/user', '/api/internal/mqtt/acl']) {
        const response = await post(path, { unexpected: true }, secret);
        expect(response.status).toBe(401);
        expect(body(response)).toMatchObject({
          result: { errorCode: 'BROKER_SECRET' },
          isSuccess: false,
          statusCode: 401,
        });
      }
      expect(findUnique).not.toHaveBeenCalled();
    },
  );

  it('validates the body once the secret is right', async () => {
    const response = await post('/api/internal/mqtt/acl', {
      username: STATION,
      topic: 't',
      acc: 9,
    });
    expect(response.status).toBe(400);
    expect(body(response)).toMatchObject({ result: { errorCode: 'VALIDATION_FAILED' } });
  });
});

describe('broker hooks with MQTT_AUTH_HOOK_SECRET unset (e2e)', () => {
  let e2e: E2eApp;
  const findUnique = jest.fn();

  beforeAll(async () => {
    e2e = await bootWith(undefined, { fieldStation: { findUnique } });
  });

  afterAll(async () => {
    await e2e.app.close();
  });

  it.each(['/api/internal/mqtt/user', '/api/internal/mqtt/acl'])(
    'answers 404 at %s, with or without a secret',
    async (path) => {
      for (const secret of [undefined, HOOK_SECRET]) {
        let call = request(e2e.app.getHttpServer()).post(path);
        if (secret) call = call.set('X-Broker-Secret', secret);
        const response = await call.send({ username: STATION, password: 'x', clientid: 'c' });
        expect(response.status).toBe(404);
        expect(body(response)).toMatchObject({ isSuccess: false, statusCode: 404 });
      }
      expect(findUnique).not.toHaveBeenCalled();
    },
  );
});
