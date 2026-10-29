import { INestApplication } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { Test } from '@nestjs/testing';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { io, Socket } from 'socket.io-client';
import { API_KEY_RESOLVER, AccessTokenAuthenticator, type SessionUser } from '../auth';
import { aSessionUser } from '../auth/testing/auth-fixtures';
import { ParameterService } from '../platform/parameters/parameter.service';
import { LiveGateway, roomsOfUser } from './live.gateway';
import { ReplayService } from './replay.service';
import { StreamEntry, StreamRepository } from './stream.repository';
import { StreamService } from './stream.service';

const staff = aSessionUser({
  id: 'staff-1',
  accountType: 'TREKLINK',
  roles: ['STAFF'],
  organization: null,
});
const admin = aSessionUser({
  id: 'admin-1',
  accountType: 'TREKLINK',
  roles: ['ADMIN'],
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

describe('roomsOfUser', () => {
  it('puts TrekLink Staff and Admin in the fleet and their own room', () => {
    expect(roomsOfUser(staff)).toEqual(['user:staff-1', 'fleet']);
    expect(roomsOfUser(admin)).toEqual(['user:admin-1', 'fleet']);
  });

  it('puts an organization member in their organization room, never the fleet', () => {
    expect(roomsOfUser(orgUser('u-1', 'o-1'))).toEqual(['user:u-1', 'org:o-1']);
  });

  it('puts a TrekLink account with no staff role in its own room only', () => {
    const plain = aSessionUser({
      id: 'p-1',
      accountType: 'TREKLINK',
      roles: [],
      organization: null,
    });
    expect(roomsOfUser(plain)).toEqual(['user:p-1']);
  });
});

// A real Socket.io server and client over the gateway, with the authenticator and the store faked.
describe('LiveGateway over a socket', () => {
  const sessions = new Map<string, SessionUser>([
    ['staff-token', staff],
    ['org-a-token', orgUser('a-1', 'org-a')],
    ['org-b-token', orgUser('b-1', 'org-b')],
  ]);
  let app: INestApplication;
  let url: string;
  let stream: StreamService;
  let gateway: LiveGateway;
  let nextSeq = 0;
  let resolveKey: jest.Mock;
  let clients: Socket[];

  // Tokens expire an hour out, except these, which expire after the given milliseconds.
  const shortLived = new Map<string, number>([['short-token', 400]]);
  sessions.set('short-token', orgUser('a-1', 'org-a'));
  const authenticate = jest.fn((token: unknown) => {
    const user = typeof token === 'string' ? sessions.get(token) : undefined;
    if (!user || typeof token !== 'string') return Promise.resolve(null);
    const expiresAt = Date.now() + (shortLived.get(token) ?? 3_600_000);
    return Promise.resolve({ user, expiresAt });
  });

  beforeAll(async () => {
    resolveKey = jest.fn();
    const repository = {
      insert: jest.fn(
        (entry: { organizationId: string | null; type: string }): Promise<StreamEntry> =>
          Promise.resolve({
            seq: ++nextSeq,
            organizationId: entry.organizationId,
            type: entry.type,
            deviceId: 'd-1',
            payload: {},
            createdAt: '2026-10-25T03:00:00.000Z',
          }),
      ),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        LiveGateway,
        StreamService,
        ReplayService,
        { provide: ParameterService, useValue: { get: () => Promise.resolve(72) } },
        { provide: StreamRepository, useValue: repository },
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
    clients = [];
    authenticate.mockClear();
    resolveKey.mockReset();
  });

  afterEach(() => clients.forEach((client) => client.close()));

  const connect = (auth: Record<string, unknown>): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const client = io(url, { auth, transports: ['websocket'], reconnection: false });
      clients.push(client);
      client.on('connect', () => resolve(client));
      client.on('connect_error', reject);
    });

  const collect = (client: Socket): number[] => {
    const seen: number[] = [];
    client.on('stream', (entry: { seq: number }) => seen.push(entry.seq));
    return seen;
  };

  const settle = () => new Promise((resolve) => setTimeout(resolve, 150));

  it('refuses a handshake with no credentials, a bad token or an unknown key', async () => {
    await expect(connect({})).rejects.toMatchObject({ data: { errorCode: 'UNAUTHENTICATED' } });
    await expect(connect({ token: 'forged' })).rejects.toMatchObject({
      data: { errorCode: 'UNAUTHENTICATED' },
    });
    resolveKey.mockResolvedValue(null);
    await expect(connect({ apiKey: 'tlk_unknown' })).rejects.toMatchObject({
      data: { errorCode: 'UNAUTHENTICATED' },
    });
  });

  it('cannot join a room by naming it, in the handshake or in an event', async () => {
    const intruder = await connect({
      token: 'org-a-token',
      room: 'fleet',
      rooms: ['fleet', 'org:org-b'],
    });
    intruder.emit('join', 'fleet');
    intruder.emit('join', { room: 'org:org-b' });
    const seen = collect(intruder);
    await settle();

    await stream.publish({ organizationId: 'org-b', type: 'device.position', payload: {} });
    await stream.publish({ organizationId: null, type: 'device.position', payload: {} });
    await settle();
    expect(seen).toEqual([]);
  });

  it('delivers an UNATTRIBUTED entry to the fleet only', async () => {
    const fleet = await connect({ token: 'staff-token' });
    const orgA = await connect({ token: 'org-a-token' });
    const fleetSeen = collect(fleet);
    const orgSeen = collect(orgA);
    await settle();

    const { seq } = await stream.publish({
      organizationId: null,
      type: 'station.stale',
      payload: {},
    });
    await settle();
    expect(fleetSeen).toEqual([seq]);
    expect(orgSeen).toEqual([]);
  });

  it('delivers an attributed entry to the fleet and its own organization, not another', async () => {
    const fleet = await connect({ token: 'staff-token' });
    const orgA = await connect({ token: 'org-a-token' });
    const orgB = await connect({ token: 'org-b-token' });
    const seen = { fleet: collect(fleet), a: collect(orgA), b: collect(orgB) };
    await settle();

    const { seq } = await stream.publish({
      organizationId: 'org-a',
      type: 'device.position',
      payload: {},
    });
    await settle();
    expect(seen.fleet).toEqual([seq]);
    expect(seen.a).toEqual([seq]);
    expect(seen.b).toEqual([]);
  });

  it('puts an API key in its organization room, resolved by the SHA-256 hex of the key', async () => {
    resolveKey.mockResolvedValue({ apiKeyId: 'k-1', organizationId: 'org-a' });
    const client = await connect({ apiKey: 'tlk_secret' });
    const seen = collect(client);
    expect(resolveKey).toHaveBeenCalledWith(expect.stringMatching(/^[0-9a-f]{64}$/));
    await settle();

    const { seq } = await stream.publish({
      organizationId: 'org-a',
      type: 'device.position',
      payload: {},
    });
    await stream.publish({ organizationId: 'org-b', type: 'device.position', payload: {} });
    await settle();
    expect(seen).toEqual([seq]);
  });

  it('closes the socket when auth.refresh carries a bad token or another account', async () => {
    const forged = await connect({ token: 'org-a-token' });
    const closed = new Promise<string>((resolve) => forged.on('disconnect', resolve));
    forged.emit('auth.refresh', { token: 'forged' });
    await expect(closed).resolves.toBe('io server disconnect');

    const other = await connect({ token: 'org-a-token' });
    const closedOther = new Promise<string>((resolve) => other.on('disconnect', resolve));
    other.emit('auth.refresh', { token: 'org-b-token' });
    await expect(closedOther).resolves.toBe('io server disconnect');
  });

  it('keeps the socket and its rooms when auth.refresh carries a valid token', async () => {
    const client = await connect({ token: 'org-a-token' });
    const seen = collect(client);
    client.emit('auth.refresh', { token: 'org-a-token' });
    await settle();
    const { seq } = await stream.publish({
      organizationId: 'org-a',
      type: 'device.position',
      payload: {},
    });
    await settle();
    expect(client.connected).toBe(true);
    expect(seen).toEqual([seq]);
  });

  it('closes the socket when its access token expires', async () => {
    const client = await connect({ token: 'short-token' });
    const closed = new Promise<string>((resolve) => client.on('disconnect', resolve));
    await expect(closed).resolves.toBe('io server disconnect');
  });

  it('keeps the socket past the old expiry after a successful auth.refresh', async () => {
    const client = await connect({ token: 'short-token' });
    client.emit('auth.refresh', { token: 'org-a-token' });
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(client.connected).toBe(true);
  });

  it('closes the sockets of a member who was deactivated, and only theirs', async () => {
    const deactivated = await connect({ token: 'org-a-token' });
    const colleague = await connect({ token: 'org-b-token' });
    const closed = new Promise<string>((resolve) => deactivated.on('disconnect', resolve));

    gateway.onMemberDeactivated({ userId: 'a-1' });

    await expect(closed).resolves.toBe('io server disconnect');
    await settle();
    expect(colleague.connected).toBe(true);
  });
});
