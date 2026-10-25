// Socket.io rooms of the `/live` namespace (specs/monitoring/design.md §2). The server alone puts a
// socket in a room; no client event names one (FR-AUTH-11, NFR-SEC-03).
export const FLEET_ROOM = 'fleet';
export const orgRoom = (organizationId: string): string => `org:${organizationId}`;
export const userRoom = (userId: string): string => `user:${userId}`;

// Rooms that receive a stream entry: the fleet always, the organization's room when the entry has
// one. An entry with no organization is platform-wide and reaches the fleet only (BR-36).
export const roomsFor = (organizationId: string | null): string[] =>
  organizationId === null ? [FLEET_ROOM] : [FLEET_ROOM, orgRoom(organizationId)];
