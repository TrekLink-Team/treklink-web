// A search text for Prisma's `contains`, `startsWith` and `endsWith` on PostgreSQL, read literally.
// Prisma passes the value into LIKE or ILIKE without escaping it, so `%` and `_` would act as wildcards
// and `\` as the escape character (verified on Postgres by test/contracts-search.db-spec.ts). Each of
// the three is escaped with `\`, the default LIKE escape.
export const likeLiteral = (text: string): string => text.replace(/[\\%_]/g, (char) => `\\${char}`);
