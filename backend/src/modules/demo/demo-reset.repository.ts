import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

// Tables whose rows come only from migrations, kept by a reset (specs/demo/design.md §3, which names the
// migration that fills each). Every other table of the connection's schema is truncated.
export const KEPT_TABLES: readonly string[] = [
  '_prisma_migrations',
  'business_parameters',
  'roles',
  'permissions',
  'role_permissions',
];

const quote = (identifier: string): string => `"${identifier.replace(/"/g, '""')}"`;

interface KeptForeignKey {
  tableName: string;
  constraintName: string;
  definition: string;
  columns: string[];
}

export interface ResetOutcome {
  truncated: string[];
  kept: readonly string[];
}

// The reset of a stage (design §3). The demo module owns no model; it reads the table list of the
// connection's schema (`public` unless DATABASE_URL names another) from `pg_tables` and runs everything
// in one transaction: a foreign key from a kept table to a truncated one (`business_parameters.
// "updatedById"` to `users`) is nulled and dropped, the data tables are truncated with RESTART IDENTITY
// CASCADE, and the key is re-created from its own definition.
@Injectable()
export class DemoResetRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reset(): Promise<ResetOutcome> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<{ tablename: string }[]>`
          SELECT tablename FROM pg_catalog.pg_tables
          WHERE schemaname = current_schema() AND tablename <> ALL(${KEPT_TABLES as string[]})
          ORDER BY tablename`;
        const truncated = rows.map((row) => row.tablename);
        if (truncated.length === 0) return { truncated, kept: KEPT_TABLES };

        const keys = await this.keptForeignKeys(tx, truncated);
        for (const key of keys) {
          const table = quote(key.tableName);
          const nulls = key.columns.map((column) => `${quote(column)} = NULL`).join(', ');
          const anySet = key.columns.map((column) => `${quote(column)} IS NOT NULL`).join(' OR ');
          await tx.$executeRawUnsafe(`UPDATE ${table} SET ${nulls} WHERE ${anySet}`);
          await tx.$executeRawUnsafe(
            `ALTER TABLE ${table} DROP CONSTRAINT ${quote(key.constraintName)}`,
          );
        }
        await tx.$executeRawUnsafe(
          `TRUNCATE TABLE ${truncated.map(quote).join(', ')} RESTART IDENTITY CASCADE`,
        );
        for (const key of keys) {
          await tx.$executeRawUnsafe(
            `ALTER TABLE ${quote(key.tableName)} ADD CONSTRAINT ${quote(key.constraintName)} ${key.definition}`,
          );
        }
        return { truncated, kept: KEPT_TABLES };
      },
      { timeout: 60_000 },
    );
  }

  private keptForeignKeys(
    tx: Prisma.TransactionClient,
    truncated: string[],
  ): Promise<KeptForeignKey[]> {
    return tx.$queryRaw<KeptForeignKey[]>`
      SELECT source.relname AS "tableName",
             con.conname AS "constraintName",
             pg_catalog.pg_get_constraintdef(con.oid) AS "definition",
             ARRAY(
               SELECT att.attname::text FROM pg_catalog.pg_attribute att
               WHERE att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
               ORDER BY att.attnum
             ) AS "columns"
      FROM pg_catalog.pg_constraint con
      JOIN pg_catalog.pg_class source ON source.oid = con.conrelid
      JOIN pg_catalog.pg_class target ON target.oid = con.confrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid = source.relnamespace
      WHERE con.contype = 'f' AND ns.nspname = current_schema()
        AND source.relname = ANY(${KEPT_TABLES as string[]})
        AND target.relname = ANY(${truncated})
      ORDER BY source.relname, con.conname`;
  }
}
