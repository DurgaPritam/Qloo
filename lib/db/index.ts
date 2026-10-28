import "server-only";

import path from "node:path";

import type { Logger } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import * as schema from "./schema";

/**
 * The raw database client. Only lib/db/scoped.ts, lib/db/unscoped.ts and lib/auth import it
 * (eslint no-restricted-imports); everything else goes through forWorkspace() (rule 3).
 *
 * With DATABASE_URL (Neon in production) it uses postgres.js. Without it, local dev, tests and
 * e2e use PGlite, a real Postgres in-process, with the same migrations. Production on Vercel
 * refuses to start without DATABASE_URL.
 */
export type DB = PgDatabase<PgQueryResultHKT, typeof schema>;

export const MIGRATIONS = path.join(process.cwd(), "drizzle");

type Env = Record<string, string | undefined>;

/** Where PGlite keeps its data: TAKEOVER_DB=memory for a throwaway database. */
export function localDbTarget(env: Env = process.env): string | null {
  if (env.DATABASE_URL?.trim()) return null;
  if (env.VERCEL_ENV) throw new Error("DATABASE_URL is required on Vercel. Workspace data must never live in a function's memory.");
  return env.TAKEOVER_DB === "memory" ? "memory://" : path.join(process.cwd(), ".data", "pglite");
}

export async function createDb(opts: { env?: Env; logger?: Logger } = {}): Promise<DB> {
  const env = opts.env ?? process.env;
  const target = localDbTarget(env);
  if (target === null) {
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    // prepare: false for Neon's pooled (PgBouncer) connection string.
    const client = postgres(env.DATABASE_URL!, { prepare: false, max: 5 });
    return drizzle(client, { schema, logger: opts.logger }) as unknown as DB;
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const client = new PGlite(target);
  const db = drizzle(client, { schema, logger: opts.logger });
  // Local databases migrate themselves; Neon is migrated by `npm run db:migrate`.
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as DB;
}

// On globalThis: route handlers and pages are separate bundles, and PGlite allows one client per
// data directory.
const shared = globalThis as typeof globalThis & { __takeoverDb?: Promise<DB> };

export function getDb(): Promise<DB> {
  shared.__takeoverDb ??= createDb().catch((err) => {
    shared.__takeoverDb = undefined;
    throw err;
  });
  return shared.__takeoverDb;
}

export { schema };
