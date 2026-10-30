import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { API_KEY_RESOLVER, AccessTokenAuthenticator, type SessionUser } from '../auth';
import { aSessionUser } from '../auth/testing/auth-fixtures';
import { ParameterService } from '../platform/parameters/parameter.service';
import { API_KEY_REVOKED } from '../organizations';
import { LiveGateway } from './live.gateway';
import { ReplayService } from './replay.service';
import { StreamEntry, StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

const staff = aSessionUser({
  id: 'staff-1',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
});
const noStream = aSessionUser({
  id: 'plain-1',
  accountType: 'TREKLINK',
  roles: [],
  organization: null,
});
const orgUser = (id: string, organizationId: string): SessionUser =>
  aSessionUser({
    id,
    accountType: 'ORGANIZATION',
    roles: ['ORG_OPERATOR'],
    organization: {
      id: organizationId,
      code: 'ORG-0001',
      legalName: 'ACME',
      status: 'ACTIVE',
      memberRole: 'OPERATOR',
    },
  });

interface Received {
  seq: number;
  type: string;
  cursor?: number;
}

// A real Socket.io server over the gateway with an in-memory stream, to prove replay (task 2.2).
describe('LiveGateway replay and key revocation', () => {
  const sessions = new Map<string, SessionUser>([
    ['staff-token', staff],
    ['plain-token', noStream],
    ['org-a-token', orgUser('a-1', 'org-a')],
    ['org-b-token', orgUser('b-1', 'org-b')],
  ]);
  let app: INestApplication;
  let url: string;
  let stream: StreamService;
  let gateway: LiveGateway;
  let store: StreamEntry[];
  let gate: Promise<void> | null;
  let expired: boolean;
  let resolveKey: jest.Mock;
  let clients: Socket[];

  beforeAll(async () => {
    resolveKey = jest.fn();
    store = [];
    gate = null;
    expired = false;
    const repository = {
      insert: jest.fn((entry: { organizationId: string | null; type: string }) => {
        const stored: StreamEntry = {
          seq: store.length + 1,
          organizationId: entry.organizationId,
          type: entry.type,
          deviceId: 'd-1',
          payload: {},
          createdAt: '2026-10-30T02:00:00.000Z',
        };
        store.push(stored);
        return Promise.resolve(stored);
      }),
      after: jest.fn(async (organizationId: string | null, seq: number, limit: number) => {
        const snapshot = store
          .filter(
            (e) => e.seq > seq && (organizationId === null || e.organizationId === organizationId),
          )
          .slice(0, limit);
        if (gate) await gate;
        return snapshot;
      }),
      oldestSeqSince: jest.fn(() => Promise.resolve(expired ? 1000 : 1)),
      maxSeq: jest.fn(() => Promise.resolve(store.length)),
    };
    const authenticate = (token: unknown) => {
      const user = typeof token === 'string' ? sessions.get(token) : undefined;
      return Promise.resolve(user ? { user, expiresAt: Date.now() + 3_600_000 } : null);
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LiveGateway,
        StreamService,
        ReplayService,
        { provide: StreamRepository, useValue: repository },
        { provide: ParameterService, useValue: { get: () => Promise.resolve(72) } },
        { provide: AccessTokenAuthenticator, useValue: { authenticate } },
        { provide: API_KEY_RESOLVER, useValue: { resolve: resolveKey } },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useWebSocketAdapter(new IoAdapter(app));
    await app.listen(0);
    url = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}/live`;
    stream = moduleRef.get(StreamService);
    gateway = moduleRef.get(LiveGateway);
  });

  afterAll(() => app.close());

  beforeEach(() => {
    store.length = 0;
    gate = null;
    expired = false;
    clients = [];
    resolveKey.mockReset();
  });

  afterEach(() => clients.forEach((client) => client.close()));

  const publish = (organizationId: string | null) =>
    stream.publish({ organizationId, type: 'device.position', payload: {} });

  const connect = (auth: Record<string, unknown>): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const client = io(url, { auth, transports: ['websocket'], reconnection: false });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });

  const collect = (client: Socket): Received[] => {
    const seen: Received[] = [];
    client.on('stream', (entry: Received) =>
      seen.push({ seq: entry.seq, type: entry.type, cursor: entry.cursor }),
    );
    return seen;
  };

  // Registers the listener before the server can send, which a connect-then-listen helper cannot.
  const connectAndCollect = (auth: Record<string, unknown>) =>
    new Promise<{ client: Socket; seen: Received[] }>((resolve, reject) => {
      const client = io(url, { auth, transports: ['websocket'], reconnection: false });
      clients.push(client);
      const seen = collect(client);
      client.on('connect', () => resolve({ client, seen }));
      client.on('connect_error', reject);
    });

  const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));
  const seqs = (seen: Received[]) => seen.map((e) => e.seq);

  it('replays every entry after the cursor, once and in order, then replay.done, then live (AC-02)', async () => {
    for (let i = 0; i < 6; i += 1) await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'staff-token', after: 2 });
    await settle();
    await publish('org-a');
    await settle();
    expect(seen.map((e) => e.type)).toEqual([
      'device.position',
      'device.position',
      'device.position',
      'device.position',
      'replay.done',
      'device.position',
    ]);
    expect(seqs(seen)).toEqual([3, 4, 5, 6, 0, 7]);
    expect(seen.find((e) => e.type === 'replay.done')?.cursor).toBe(6);
  });

  it('replays an organization only its own entries, never another organization or the fleet-only ones', async () => {
    await publish('org-a');
    await publish('org-b');
    await publish(null);
    await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'org-a-token', after: 0 });
    await settle();
    expect(seqs(seen)).toEqual([1, 4, 0]);
    expect(seen[2]).toMatchObject({ type: 'replay.done', cursor: 4 });
  });

  it('replays an API key socket its organization only', async () => {
    resolveKey.mockResolvedValue({ apiKeyId: 'key-1', organizationId: 'org-b' });
    await publish('org-a');
    await publish('org-b');
    const { seen } = await connectAndCollect({ apiKey: 'tlk_x', after: 0 });
    await settle();
    expect(seqs(seen)).toEqual([2, 0]);
  });

  it('answers an empty replay with replay.done at the cursor it was given', async () => {
    await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'org-b-token', after: 1 });
    await settle();
    expect(seen).toEqual([{ seq: 0, type: 'replay.done', cursor: 1 }]);
  });

  it('does not replay on a first connect, which has no cursor', async () => {
    await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'org-a-token' });
    await settle();
    expect(seen).toEqual([]);
  });

  it('treats a cursor that is not a non-negative integer as no cursor', async () => {
    await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'org-a-token', after: -3 });
    await settle();
    expect(seen).toEqual([]);
  });

  it('keeps every entry once and in order when entries arrive while it replays', async () => {
    for (let i = 0; i < 3; i += 1) await publish('org-a');
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { seen } = await connectAndCollect({ token: 'staff-token', after: 0 });
    await settle(100);
    await publish('org-a');
    await publish('org-b');
    expect(seen).toEqual([]);
    gate = null;
    release();
    await settle();
    await publish('org-a');
    await settle();
    expect(seqs(seen)).toEqual([1, 2, 3, 4, 5, 0, 6]);
    expect(new Set(seqs(seen.filter((e) => e.seq > 0))).size).toBe(6);
  });

  it('answers a cursor older than the retention window with replay.expired and no replay', async () => {
    await publish('org-a');
    await publish('org-a');
    expired = true;
    const { seen } = await connectAndCollect({ token: 'staff-token', after: 0 });
    await settle();
    expect(seen).toEqual([{ seq: 0, type: 'replay.expired', cursor: undefined }]);
    await publish('org-a');
    await settle();
    expect(seqs(seen)).toEqual([0, 3]);
  });

  it('tells an account with no stream rights that it is caught up, and sends it nothing', async () => {
    await publish('org-a');
    const { seen } = await connectAndCollect({ token: 'plain-token', after: 0 });
    await settle();
    await publish('org-a');
    await settle();
    expect(seen).toEqual([{ seq: 0, type: 'replay.done', cursor: 0 }]);
  });

  it('stops replaying a socket that disconnected mid-replay', async () => {
    for (let i = 0; i < 3; i += 1) await publish('org-a');
    let release: () => void = () => undefined;
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { client, seen } = await connectAndCollect({ token: 'staff-token', after: 0 });
    await settle(100);
    client.close();
    gate = null;
    release();
    await settle();
    expect(seen).toEqual([]);
  });

  describe('API key revocation (FR-ORG-06, E04-5)', () => {
    it('closes the socket of the revoked key with KEY_REVOKED, and no other socket of the organization', async () => {
      resolveKey.mockImplementation((hash: string) =>
        Promise.resolve({ apiKeyId: hash === keyOne ? 'key-1' : 'key-2', organizationId: 'org-a' }),
      );
      const { hashApiKey } = await import('../auth');
      const keyOne = hashApiKey('tlk_one');
      const revoked = await connect({ apiKey: 'tlk_one' });
      const sibling = await connect({ apiKey: 'tlk_two' });
      const member = await connect({ token: 'org-a-token' });
      const message = new Promise<unknown>((resolve) => revoked.on('auth.error', resolve));
      const closed = new Promise<string>((resolve) => revoked.on('disconnect', resolve));

      await gateway.onApiKeyRevoked({ organizationId: 'org-a', apiKeyId: 'key-1' });

      await expect(message).resolves.toEqual({ errorCode: 'KEY_REVOKED' });
      await expect(closed).resolves.toBe('io server disconnect');
      await settle();
      expect(sibling.connected).toBe(true);
      expect(member.connected).toBe(true);
    });

    it('leaves another organization key with the same id alone', async () => {
      resolveKey.mockResolvedValue({ apiKeyId: 'key-1', organizationId: 'org-b' });
      const other = await connect({ apiKey: 'tlk_other' });
      await gateway.onApiKeyRevoked({ organizationId: 'org-a', apiKeyId: 'key-1' });
      await settle();
      expect(other.connected).toBe(true);
    });

    it('reacts to the platform event name', () => {
      expect(API_KEY_REVOKED).toBe('apiKey.revoked');
    });
  });
});
