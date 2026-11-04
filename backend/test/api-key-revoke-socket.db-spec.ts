import './db-app-env';
import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { performance } from 'node:perf_hooks';
import { io, Socket } from 'socket.io-client';
import { Caller } from '../src/common/decorators/access.decorator';
import { LiveIoAdapter } from '../src/modules/monitoring/live-io.adapter';
import { ApiKeysService } from '../src/modules/organizations/api-keys.service';
import { OrganizationStatusService } from '../src/modules/organizations/organization-status.service';
import { compileRentalFlow, RentalFlow } from './db-rental-flow';

interface Client {
  socket: Socket;
  errors: unknown[];
  reason: string | null;
}

// Monitoring task 2.2 (FR-ORG-06, E04-5) with the real parts: `ApiKeysService` revokes a key in a
// PostgreSQL transaction, the after-commit event reaches the gateway, and loopback Socket.IO clients
// see their sockets close. The unit spec of the gateway mocks the key resolver and calls
// `onApiKeyRevoked` itself; here nothing is mocked. Fixtures carry fresh organizations; nothing
// existing is deleted.
describe('API key revocation closes the sockets of the key (monitoring 2.2)', () => {
  let flow: RentalFlow;
  let app: INestApplication;
  let url: string;
  let keys: ApiKeysService;
  const clients: Client[] = [];

  const until = async (predicate: () => boolean, timeout = 5000) => {
    const end = performance.now() + timeout;
    while (!predicate()) {
      if (performance.now() >= end) throw new Error('Socket verification timed out');
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const quiet = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));
  const connect = async (auth: Record<string, unknown>): Promise<Client> => {
    const socket = io(url, {
      auth,
      transports: ['websocket'],
      reconnection: false,
      autoConnect: false,
    });
    const client: Client = { socket, errors: [], reason: null };
    clients.push(client);
    socket.on('auth.error', (error) => client.errors.push(error));
    socket.on('disconnect', (reason) => {
      client.reason = reason;
    });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Handshake timed out')), 3000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.connect();
    });
    return client;
  };
  const asMember = async (caller: Caller) =>
    connect({ token: await flow.get(JwtService).signAsync({ sub: caller.id, pv: 0 }) });

  beforeAll(async () => {
    flow = await compileRentalFlow();
    keys = flow.get(ApiKeysService);
    app = flow.moduleRef.createNestApplication();
    app.useLogger(false);
    app.useWebSocketAdapter(new LiveIoAdapter(app, ['http://localhost']));
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${((app.getHttpServer() as Server).address() as AddressInfo).port}/live`;
  }, 120_000);
  afterEach(() => {
    clients.splice(0).forEach(({ socket }) => socket.close());
  });
  afterAll(async () => {
    if (app) await app.close();
    else if (flow) await flow.close();
  });

  it('closes the socket of the revoked key with KEY_REVOKED and leaves every other socket open', async () => {
    const orgA = await flow.organization();
    const orgB = await flow.organization();
    const first = await keys.create(orgA.id, 'first', orgA.manager);
    const second = await keys.create(orgA.id, 'second', orgA.manager);
    const other = await keys.create(orgB.id, 'other', orgB.manager);
    const revoked = await connect({ apiKey: first.key });
    const sibling = await connect({ apiKey: second.key });
    const member = await asMember(orgA.manager);
    const foreign = await connect({ apiKey: other.key });

    await keys.revoke(orgA.id, first.id, orgA.manager);

    await until(() => !revoked.socket.connected);
    expect(revoked.errors).toEqual([{ errorCode: 'KEY_REVOKED' }]);
    expect(revoked.reason).toBe('io server disconnect');
    await quiet();
    expect(sibling.socket.connected).toBe(true);
    expect(member.socket.connected).toBe(true);
    expect(foreign.socket.connected).toBe(true);
    expect(sibling.errors).toEqual([]);
  });

  it('refuses the handshake of a revoked key and still accepts its sibling', async () => {
    const org = await flow.organization();
    const first = await keys.create(org.id, 'first', org.manager);
    const second = await keys.create(org.id, 'second', org.manager);
    await keys.revoke(org.id, first.id, org.manager);

    await expect(connect({ apiKey: first.key })).rejects.toThrow(/UNAUTHENTICATED/i);
    const accepted = await connect({ apiKey: second.key });
    expect(accepted.socket.connected).toBe(true);
  });

  it('closes every key socket and every member socket when the organization is closed, and no other', async () => {
    const closing = await flow.organization();
    const staying = await flow.organization();
    const admin = await flow.admin();
    const one = await keys.create(closing.id, 'one', closing.manager);
    const two = await keys.create(closing.id, 'two', closing.manager);
    const kept = await keys.create(staying.id, 'kept', staying.manager);
    const keyOne = await connect({ apiKey: one.key });
    const keyTwo = await connect({ apiKey: two.key });
    const member = await asMember(closing.manager);
    const keptKey = await connect({ apiKey: kept.key });
    const keptMember = await asMember(staying.manager);

    const { version } = await flow.prisma.organization.findUniqueOrThrow({
      where: { id: closing.id },
    });
    await flow.get(OrganizationStatusService).close(closing.id, 'Test closure', version, admin);

    await until(
      () => !keyOne.socket.connected && !keyTwo.socket.connected && !member.socket.connected,
    );
    expect(keyOne.errors).toEqual([{ errorCode: 'KEY_REVOKED' }]);
    expect(keyTwo.errors).toEqual([{ errorCode: 'KEY_REVOKED' }]);
    await quiet();
    expect(keptKey.socket.connected).toBe(true);
    expect(keptMember.socket.connected).toBe(true);
  });
});
