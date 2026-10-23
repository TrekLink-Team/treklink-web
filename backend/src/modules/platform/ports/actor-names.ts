import { AccountDirectory } from './account-directory.port';

export interface ActorRef {
  id: string;
  fullName: string | null;
}

// Resolves actor ids to `{ id, fullName }` in one directory call. Without a provider (a test module
// without `auth`) every name is null rather than failing the read.
export const resolveActors = async (
  directory: AccountDirectory | undefined,
  ids: readonly (string | null)[],
): Promise<(id: string | null) => ActorRef | null> => {
  const unique = [...new Set(ids.filter((id): id is string => id !== null))];
  const names =
    directory && unique.length > 0 ? await directory.namesOf(unique) : new Map<string, string>();
  return (id) => (id === null ? null : { id, fullName: names.get(id) ?? null });
};
