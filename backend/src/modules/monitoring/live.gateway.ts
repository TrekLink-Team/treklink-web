import { createHash } from 'crypto';
import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace as IoNamespace, Socket as IoSocket } from 'socket.io';
import { ErrorCode } from '../../common/errors';
import {
  API_KEY_RESOLVER,
  AccessTokenAuthenticator,
  type ApiKeyResolver,
  type SessionUser,
} from '../auth';
import { FLEET_ROOM, orgRoom, userRoom } from './rooms';
import { StreamService, WireEntry } from './stream.service';

// Who the server decided this socket is. Rooms come from here and nowhere else.
interface LiveIdentity {
  userId: string | null;
  rooms: string[];
}

// The server-decided identity travels in `socket.data`, typed so it is never read as `any`.
type LiveSocket = IoSocket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { identity: LiveIdentity }
>;
type LiveNamespace = IoNamespace<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  { identity: LiveIdentity }
>;

const TREKLINK_STAFF_ROLES: ReadonlySet<string> = new Set(['STAFF', 'ADMIN']);

// Rooms of a signed-in account (specs/monitoring/design.md §2): TrekLink Staff and Admin the fleet,
// an organization member their organization, and every user their own room for `incident.alert`.
export const roomsOfUser = (user: SessionUser): string[] => [
  userRoom(user.id),
  ...(user.accountType === 'TREKLINK' && user.roles.some((role) => TREKLINK_STAFF_ROLES.has(role))
    ? [FLEET_ROOM]
    : []),
  ...(user.organization ? [orgRoom(user.organization.id)] : []),
];

// An API key is stored only as its SHA-256 hex, the same as a refresh token (REQ-UBI-02).
const hashApiKey = (key: string): string => createHash('sha256').update(key).digest('hex');

const unauthenticated = (): Error =>
  Object.assign(new Error(ErrorCode.UNAUTHENTICATED), {
    data: { errorCode: ErrorCode.UNAUTHENTICATED },
  });

// Socket.io namespace `/live` (task 1.1, FR-MON-02; ws-live-contract). One authenticated socket per
// client, joined to rooms by the server only. The only client event is `auth.refresh`; nothing a
// client sends can name a room. Replay on connect is task 2.2.
@Injectable()
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private namespace!: LiveNamespace;

  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly authenticator: AccessTokenAuthenticator,
    private readonly stream: StreamService,
    @Optional()
    @Inject(API_KEY_RESOLVER)
    private readonly apiKeys?: ApiKeyResolver,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.stream.subscribe((rooms, entry) => this.publish(rooms, entry));
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  // The handshake: a JWT or an API key, else `connect_error` with UNAUTHENTICATED and the socket closes.
  afterInit(namespace: LiveNamespace): void {
    namespace.use((socket, next) => {
      this.identify(socket.handshake.auth).then(
        (identity) => {
          if (!identity) return next(unauthenticated());
          socket.data.identity = identity;
          next();
        },
        () => next(unauthenticated()),
      );
    });
  }

  handleConnection(socket: LiveSocket): void {
    void socket.join(socket.data.identity.rooms);
  }

  // A token refreshed during the session is re-validated. A failure, or a token of another account,
  // closes the socket. A role change takes effect here: rooms are recomputed.
  @SubscribeMessage('auth.refresh')
  async refresh(
    @ConnectedSocket() socket: LiveSocket,
    @MessageBody() body: { token?: unknown } | undefined,
  ): Promise<void> {
    const identity = socket.data.identity;
    if (identity.userId === null) return;
    const user = await this.authenticator.authenticate(body?.token);
    if (!user || user.id !== identity.userId) {
      socket.disconnect(true);
      return;
    }
    const rooms = roomsOfUser(user);
    for (const room of identity.rooms) if (!rooms.includes(room)) void socket.leave(room);
    void socket.join(rooms);
    identity.rooms = rooms;
  }

  publish(rooms: string[], entry: WireEntry): void {
    this.namespace.to(rooms).emit('stream', entry);
  }

  private async identify(auth: Record<string, unknown> | undefined): Promise<LiveIdentity | null> {
    if (typeof auth?.apiKey === 'string' && auth.apiKey !== '') {
      const key = await this.apiKeys?.resolve(hashApiKey(auth.apiKey));
      return key ? { userId: null, rooms: [orgRoom(key.organizationId)] } : null;
    }
    const user = await this.authenticator.authenticate(auth?.token);
    return user ? { userId: user.id, rooms: roomsOfUser(user) } : null;
  }
}
