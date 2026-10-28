import { describe, expect, it } from "vitest";

import { expectAllScoped, findUnscoped } from "./scoped-queries";

const TENANT = ["plans", "notes"];
const check = (...sql: string[]) => findUnscoped(sql.map((s) => ({ sql: s })), TENANT);

describe("findUnscoped", () => {
  it("passes a select with a qualified workspace condition", () => {
    expect(check('select "plans"."id" from "plans" where ("plans"."workspace_id" = $1 and "plans"."id" = $2)')).toEqual([]);
  });

  it("passes a single-table query with a bare workspace condition", () => {
    expect(check('delete from "notes" where "workspace_id" = $1 and "id" = $2')).toEqual([]);
  });

  it("fails a select with no workspace condition", () => {
    expect(check('select "id" from "plans" where "plans"."id" = $1')).toMatchObject([{ table: "plans" }]);
  });

  it("does not take a selected workspace_id column for a condition", () => {
    expect(check('select "plans"."workspace_id" from "plans"')).toHaveLength(1);
  });

  it("fails a join whose second tenant table is unscoped", () => {
    const sql =
      'select * from "plans" left join "notes" on "notes"."plan_id" = "plans"."id" where "plans"."workspace_id" = $1';
    expect(check(sql)).toMatchObject([{ table: "notes" }]);
  });

  it("handles aliases", () => {
    expect(check('select * from "plans" "p" where "p"."workspace_id" = $1')).toEqual([]);
  });

  it("fails an insert without workspace_id and passes one with it", () => {
    expect(check('insert into "plans" ("id", "query") values ($1, $2)')).toMatchObject([{ reason: /insert/ }]);
    expect(check('insert into "plans" ("id", "workspace_id", "query") values ($1, $2, $3)')).toEqual([]);
  });

  it("fails an update without a workspace condition", () => {
    expect(check('update "notes" set "body" = $1 where "notes"."id" = $2')).toHaveLength(1);
  });

  it("ignores tables that hold no customer data", () => {
    expect(check('select * from "users" where "users"."email" = $1')).toEqual([]);
  });

  it("expectAllScoped throws with every offending query", () => {
    expect(() => expectAllScoped([{ sql: 'select * from "plans"' }], TENANT)).toThrow(/plans: select without/);
  });
});
