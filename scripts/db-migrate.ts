/**
 * Applies drizzle/ migrations to the database in DATABASE_URL_UNPOOLED (Neon's direct
 * connection). Local PGlite databases migrate themselves on first use.
 *
 *   npm run db:migrate
 */
import { loadEnvConfig } from "@next/env";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

loadEnvConfig(process.cwd());

const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim();
if (!url) {
  console.error("Set DATABASE_URL_UNPOOLED (or DATABASE_URL) in .env.local. Local PGlite needs no migration step.");
  process.exit(1);
}

async function main(databaseUrl: string) {
  const client = postgres(databaseUrl, { max: 1 });
  try {
    await migrate(drizzle(client), { migrationsFolder: "drizzle" });
    console.log("Migrations applied.");
  } finally {
    await client.end();
  }
}

void main(url);
