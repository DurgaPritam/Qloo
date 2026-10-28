import { defineConfig } from "drizzle-kit";

// Generates SQL migrations into drizzle/. They run against Neon with `npm run db:migrate` and
// automatically against local PGlite databases (lib/db/index.ts).
export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
});
