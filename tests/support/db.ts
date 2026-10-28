import { users } from "@/lib/db/schema";
import { createDb, type DB } from "@/lib/db";
import type { LoggedQuery } from "./scoped-queries";

/** A fresh in-memory Postgres (PGlite) with the real migrations, recording every query. */
export async function testDb(): Promise<{ db: DB; queries: LoggedQuery[] }> {
  const queries: LoggedQuery[] = [];
  const db = await createDb({ env: { TAKEOVER_DB: "memory" }, logger: { logQuery: (sql) => queries.push({ sql }) } });
  return { db, queries };
}

export async function addUser(db: DB, email: string, name?: string): Promise<{ id: string; email: string; name: string | null }> {
  const [u] = await db.insert(users).values({ email, name: name ?? null }).returning();
  return { id: u.id, email: u.email!, name: u.name };
}
