import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
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
import { API_KEY_REVOKED, type ApiKeyRevokedEvent } from '../organizations';
import { ReplayService } from './replay.service';
import { FLEET_ROOM, REPLAYING_ROOM, orgRoom, replayScopeOf, userRoom } from './rooms';
import { StreamService, WireEntry } from './stream.service';

// Who the server decided this socket is. Rooms come from here and nowhere else.
interface LiveIdentity {
  userId: string | null;
  rooms: string[];
  // The API key behind an API-key socket, so revoking it closes that socket only.
  apiKeyId: string | null;
  // The cursor the client reconnected with, or null on a first connect.
  after: number | null;
  // When the access token expires, in epoch milliseconds; null for an API key.
  expiresAt: number | null;
  expiryTimer: NodeJS.Timeout | null;
}

// Live entries that arrive for a socket while it replays, delivered after the replay in `seq` order.
interface ReplayState {
  rooms: string[];
  pending: WireEntry[];
}

// A cursor is a non-negative integer; anything else is treated as no cursor.
const parseCursor = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

// Control messages travel as the `stream` event with seq 0, so a client needs one listener.
const control = (type: 'replay.done' | 'replay.expired', cursor?: number) => ({
  seq: 0,
  type,
  deviceId: null,
  payload: {},
  createdAt: new Date().toISOString(),
  ...(cursor === undefined ? {} : { cursor }),
});

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
// deactivation (REQ-UBI-01). A client that reconnects with a cursor is replayed what it missed, then
// `replay.done`, then live (task 2.2).
@Injectable()
@WebSocketGateway({ namespace: '/live' })
export class LiveGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  private namespace!: LiveNamespace;

  private unsubscribe: (() => void) | null = null;
  private readonly logger = new Logger(LiveGateway.name);
  private readonly replaying = new Map<string, ReplayState>();

  constructor(
    private readonly authenticator: AccessTokenAuthenticator,
    private readonly stream: StreamService,
    private readonly replays: ReplayService,
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
    const identity = socket.data.identity;
    this.armExpiry(socket);
    if (identity.after === null) {
      void socket.join(identity.rooms);
      return;
    }
    void this.replay(socket, identity.after);
  }

  handleDisconnect(socket: LiveSocket): void {
    this.replaying.delete(socket.id);
    const timer = socket.data.identity.expiryTimer;
    if (timer) clearTimeout(timer);
  }

  // A deactivated member stops receiving at once: their sockets are closed, and the client's recovery
  // asks the API, which now answers 401.
  @OnEvent(MEMBER_DEACTIVATED)
  onMemberDeactivated({ userId }: MemberDeactivatedEvent): void {
    this.namespace.in(userRoom(userId)).disconnectSockets(true);
  }

  // A revoked key closes its own sockets and no other socket of the organization (FR-ORG-06, E04-5).
  @OnEvent(API_KEY_REVOKED)
  async onApiKeyRevoked({ organizationId, apiKeyId }: ApiKeyRevokedEvent): Promise<void> {
    const sockets = await this.namespace.in(orgRoom(organizationId)).fetchSockets();
    for (const socket of sockets) {
      if (socket.data.identity.apiKeyId !== apiKeyId) continue;
      socket.emit('auth.error', { errorCode: 'KEY_REVOKED' });
      socket.disconnect(true);
    }
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
    const replaying = this.replaying.get(socket.id);
    if (replaying) replaying.rooms = rooms;
    identity.expiresAt = session.expiresAt;
    this.armExpiry(socket);
  }

  // A live entry goes to the rooms, except to sockets still replaying: those get it buffered, and the
  // replay delivers it in order once they have caught up.
  publish(rooms: string[], entry: WireEntry): void {
    for (const state of this.replaying.values()) {
      if (state.rooms.some((room) => rooms.includes(room))) state.pending.push(entry);
    }
    this.namespace.to(rooms).except(REPLAYING_ROOM).emit('stream', entry);
  }

  // Catches a reconnecting client up: every entry after its cursor that it may see, oldest first, then
  // what arrived live meanwhile, then `replay.done`. The socket sits in the replaying room until the
  // last step, which runs without waiting, so no live entry can slip between the replay and the live
  // stream. A cursor older than the retention window gets `replay.expired` and no replay (E04-3).
  private async replay(socket: LiveSocket, after: number): Promise<void> {
    const identity = socket.data.identity;
    const scope = replayScopeOf(identity.rooms);
    if (scope === null) {
      void socket.join(identity.rooms);
      socket.emit('stream', control('replay.done', after));
      return;
    }
    const state: ReplayState = { rooms: identity.rooms, pending: [] };
    this.replaying.set(socket.id, state);
    void socket.join([...identity.rooms, REPLAYING_ROOM]);
    try {
      if (await this.replays.isExpired(after)) {
        this.replaying.delete(socket.id);
        void socket.leave(REPLAYING_ROOM);
        socket.emit('stream', control('replay.expired'));
        return;
      }
      let last = after;
      for (;;) {
        const batch = await this.replays.batchAfter(scope.organizationId, last);
        if (!socket.connected) return;
        if (batch.length === 0) break;
        for (const entry of batch) socket.emit('stream', entry);
        last = batch[batch.length - 1].seq;
      }
      for (const entry of [...state.pending].sort((a, b) => a.seq - b.seq)) {
        if (entry.seq <= last) continue;
        socket.emit('stream', entry);
        last = entry.seq;
      }
      this.replaying.delete(socket.id);
      void socket.leave(REPLAYING_ROOM);
      socket.emit('stream', control('replay.done', last));
    } catch (error) {
      // The client reconnects with the same cursor and tries again.
      this.logger.error(`Replay failed for socket ${socket.id}: ${String(error)}`);
      this.replaying.delete(socket.id);
      socket.disconnect(true);
    }
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
            apiKeyId: key.apiKeyId,
            after: parseCursor(auth.after),
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
          apiKeyId: null,
          after: parseCursor(auth?.after),
          expiresAt: session.expiresAt,
          expiryTimer: null,
        }
      : null;
  }
}
