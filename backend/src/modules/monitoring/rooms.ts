// Socket.io rooms of the `/live` namespace (specs/monitoring/design.md §2). The server alone puts a
// socket in a room; no client event names one (FR-AUTH-11, NFR-SEC-03).
export const FLEET_ROOM = 'fleet';
export const orgRoom = (organizationId: string): string => `org:${organizationId}`;
export const userRoom = (userId: string): string => `user:${userId}`;

// Sockets that are still catching up wait in this room. Live entries skip it and are buffered for the
// socket instead, so a replay and the live stream never interleave out of order (task 2.2).
export const REPLAYING_ROOM = 'replaying';

// What a socket may replay, from the rooms the server gave it: the fleet sees every entry (null), an
// organization its own, and a socket with neither has nothing to replay (null scope).
export const replayScopeOf = (
  rooms: readonly string[],
): { organizationId: string | null } | null => {
  if (rooms.includes(FLEET_ROOM)) return { organizationId: null };
  const org = rooms.find((room) => room.startsWith('org:'));
  return org === undefined ? null : { organizationId: org.slice('org:'.length) };
};

// Rooms that receive a stream entry: the fleet always, the organization's room when the entry has
// one. An entry with no organization is platform-wide and reaches the fleet only (BR-36).
export const roomsFor = (organizationId: string | null): string[] =>
  organizationId === null ? [FLEET_ROOM] : [FLEET_ROOM, orgRoom(organizationId)];
