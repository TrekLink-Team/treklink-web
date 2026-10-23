// Display names of accounts for read models that show an actor (parameter history, audit log).
// Declared by `platform`, which may not read `users` (owned by `auth`); provided by `auth`
// (platform design §2.1, the D-032 pattern).
export const ACCOUNT_DIRECTORY = Symbol('ACCOUNT_DIRECTORY');

export interface AccountDirectory {
  // Full name per account id; an unknown id is absent from the map. Soft-deleted accounts resolve too,
  // so an old audit row keeps its actor (auth REQ-UBI-07).
  namesOf(userIds: readonly string[]): Promise<Map<string, string>>;
}
