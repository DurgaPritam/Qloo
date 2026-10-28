/**
 * Fails a test when SQL touches a workspace table without a workspace_id condition
 * (docs/roadmap-rules.md, rule 3). It reads the SQL Drizzle emits for Postgres, so it works from
 * a query logger and needs no database: tenant tables are those with a workspace_id column.
 *
 * It proves the condition is there, not that its value is the signed-in user's workspace; the
 * scoped repository (docs/architecture.md) is what passes that value.
 */

export interface LoggedQuery {
  sql: string;
}

export interface Unscoped {
  sql: string;
  table: string;
  reason: string;
}

// from "plans" | join "notes" "n" | update "plans" | delete from "plans" | insert into "plans"
const TABLE_REF = /\b(from|join|update|into)\s+"(\w+)"(?:\s+(?:as\s+)?"(\w+)")?/gi;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Every reference to a tenant table that has no workspace_id condition. */
export function findUnscoped(queries: readonly LoggedQuery[], tenantTables: readonly string[]): Unscoped[] {
  const tenants = new Set(tenantTables);
  const out: Unscoped[] = [];
  for (const { sql } of queries) {
    const refs = [...sql.matchAll(TABLE_REF)].map((m) => ({ keyword: m[1].toLowerCase(), table: m[2], alias: m[3] ?? m[2] }));
    const single = new Set(refs.map((r) => r.table)).size === 1;
    const statement = sql.trim().split(/\s/)[0].toLowerCase();
    for (const r of refs) {
      if (!tenants.has(r.table)) continue;
      if (r.keyword === "into") {
        const cols = sql.match(new RegExp(`into\\s+"${escape(r.table)}"\\s*\\(([^)]*)\\)`, "i"))?.[1] ?? "";
        if (!/"workspace_id"/.test(cols)) out.push({ sql, table: r.table, reason: "insert without a workspace_id value" });
        continue;
      }
      // "alias"."workspace_id" = $1, or a bare "workspace_id" = $1 when it is the only table.
      const qualified = new RegExp(`"${escape(r.alias)}"\\."workspace_id"\\s*(=|in\\b)`, "i");
      const bare = /(^|[^.])"workspace_id"\s*(=|in\b)/i;
      if (!qualified.test(sql) && !(single && bare.test(sql))) {
        out.push({ sql, table: r.table, reason: `${statement} without a workspace_id condition` });
      }
    }
  }
  return out;
}

/** Throws with every offending query, for use at the end of a test. */
export function expectAllScoped(queries: readonly LoggedQuery[], tenantTables: readonly string[]): void {
  const bad = findUnscoped(queries, tenantTables);
  if (bad.length) {
    throw new Error(`Unscoped queries (rule: every query on customer data is scoped to the workspace):\n${bad
      .map((b) => `- ${b.table}: ${b.reason}\n  ${b.sql}`)
      .join("\n")}`);
  }
}
