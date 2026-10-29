import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
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
  MEMBER_DEACTIVATED,
  hashApiKey,
  type ApiKeyResolver,
  type MemberDeactivatedEvent,
  type SessionUser,
} from '../auth';
import { INCIDENT_ALERT, type IncidentAlertEvent } from '../incidents';
import { FLEET_ROOM, orgRoom, userRoom } from './rooms';
import { StreamService, WireEntry } from './stream.service';

// Who the server decided this socket is. Rooms come from here and nowhere else.
interface LiveIdentity {
  userId: string | null;
  rooms: string[];
  // When the access token expires, in epoch milliseconds; null for an API key.
  expiresAt: number | null;
  expiryTimer: NodeJS.Timeout | null;
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

const unauthenticated = (): Error =>
  Object.assign(new Error(ErrorCode.UNAUTHENTICATED), {
    data: { errorCode: ErrorCode.UNAUTHENTICATED },
  });

// Socket.io namespace `/live` (task 1.1, FR-MON-02; ws-live-contract). One authenticated socket per
// client, joined to rooms by the server only. The only client event is `auth.refresh`; nothing a
// client sends can name a room. A socket ends with its access token, and with its member's
// deactivation (REQ-UBI-01). Replay on connect is task 2.2.
@Injectable()
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
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
    this.armExpiry(socket);
  }

  handleDisconnect(socket: LiveSocket): void {
    const timer = socket.data.identity.expiryTimer;
    if (timer) clearTimeout(timer);
  }

  // A deactivated member stops receiving at once: their sockets are closed, and the client's recovery
  // asks the API, which now answers 401.
  @OnEvent(MEMBER_DEACTIVATED)
  onMemberDeactivated({ userId }: MemberDeactivatedEvent): void {
    this.namespace.in(userRoom(userId)).disconnectSockets(true);
  }

  // Task 2.3: an incident alert goes to the recipient's own room only, as a `stream` event with
  // seq 0. It is not a stored stream entry, so the client handles it outside its replay cursor
  // (incidents design §3). Synchronous: the dispatcher counts the alert sent when this returns.
  @OnEvent(INCIDENT_ALERT)
  onIncidentAlert({ recipientId, alert }: IncidentAlertEvent): void {
    this.namespace.to(userRoom(recipientId)).emit('stream', {
      seq: 0,
      type: INCIDENT_ALERT,
      deviceId: null,
      payload: alert,
      createdAt: alert.at,
    });
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
    const session = await this.authenticator.authenticate(body?.token);
    if (!session || session.user.id !== identity.userId) {
      socket.disconnect(true);
      return;
    }
    const rooms = roomsOfUser(session.user);
    for (const room of identity.rooms) if (!rooms.includes(room)) void socket.leave(room);
    void socket.join(rooms);
    identity.rooms = rooms;
    identity.expiresAt = session.expiresAt;
    this.armExpiry(socket);
  }

  publish(rooms: string[], entry: WireEntry): void {
    this.namespace.to(rooms).emit('stream', entry);
  }

  // The server enforces "refresh before expiry": at the token's expiry the socket closes, unless an
  // auth.refresh moved the expiry first.
  private armExpiry(socket: LiveSocket): void {
    const identity = socket.data.identity;
    if (identity.expiryTimer) clearTimeout(identity.expiryTimer);
    identity.expiryTimer = null;
    if (identity.expiresAt === null) return;
    const delay = Math.max(0, identity.expiresAt - Date.now());
    identity.expiryTimer = setTimeout(() => socket.disconnect(true), delay);
    identity.expiryTimer.unref();
  }

  private async identify(auth: Record<string, unknown> | undefined): Promise<LiveIdentity | null> {
    if (typeof auth?.apiKey === 'string' && auth.apiKey !== '') {
      const key = await this.apiKeys?.resolve(hashApiKey(auth.apiKey));
      return key
        ? {
            userId: null,
            rooms: [orgRoom(key.organizationId)],
            expiresAt: null,
            expiryTimer: null,
          }
        : null;
    }
    const session = await this.authenticator.authenticate(auth?.token);
    return session
      ? {
          userId: session.user.id,
          rooms: roomsOfUser(session.user),
          expiresAt: session.expiresAt,
          expiryTimer: null,
        }
      : null;
  }
}
