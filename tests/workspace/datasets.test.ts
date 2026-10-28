import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { count, eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { LlmPlanner, ScriptedPlanner } from "@/lib/agent/planner";
import { combineCityScores } from "@/lib/engine/combine";
import { datasetView, deleteDataset, ingest, metricByCity, planCityScores } from "@/lib/data/service";
import type { ColumnRole } from "@/lib/data/types";
import type { DB } from "@/lib/db";
import { forWorkspace } from "@/lib/db/scoped";
import { datasetRows, datasets, TENANT_TABLES } from "@/lib/db/schema";
import { unscopedAcceptInvitation, unscopedEnsurePersonalWorkspace } from "@/lib/db/unscoped";
import { MemoryStore } from "@/lib/files/store";
import type { ChatOptions, ChatTurn, LLMProvider, ToolResult } from "@/lib/llm/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import { ForbiddenError } from "@/lib/workspace/permissions";

import { addUser, testDb } from "../support/db";
import { expectAllScoped, type LoggedQuery } from "../support/scoped-queries";

let db: DB;
let queries: LoggedQuery[];
let store: MemoryStore;

/** Distinctive values: none of them may ever appear in a prompt. */
const SECRET_NAME = "secret-ticket-sales-QX7.csv";
const CSV = [
  "metro_name,country,tix,gross_usd,show_date",
  "Los Angeles,US,987654,123456.78,2026-03-14",
  "Brooklyn,US,555111,,2026-04-18",
  "Chicago,,333222,40000,2026-04-02",
  "Springfield,US,4321,900,2026-05-01",
  "Zzxq Town,US,77,10,2026-05-02",
  ",US,1,1,2026-05-03",
].join("\n");
const MAPPING: Record<string, ColumnRole> = {
  metro_name: { role: "city" },
  country: { role: "country" },
  tix: { role: "metric", kind: "tickets" },
  gross_usd: { role: "metric", kind: "revenue" },
  show_date: { role: "ignore" },
};
const PHOEBE = { id: "mock:seed:phoebe-bridgers:artist", name: "Phoebe Bridgers", category: "artist" as const };

async function person(email: string) {
  const user = await addUser(db, email, email.split("@")[0]);
  const workspaceId = await unscopedEnsurePersonalWorkspace(db, user);
  return { user, workspaceId, repo: forWorkspace(db, { userId: user.id, workspaceId, role: "owner" }) };
}

const upload = (repo: ReturnType<typeof forWorkspace>) => ingest(repo, { name: SECRET_NAME, bytes: new TextEncoder().encode(CSV), mapping: MAPPING }, store);

beforeAll(async () => {
  ({ db, queries } = await testDb());
});

beforeEach(() => {
  queries.length = 0;
  store = new MemoryStore();
  vi.stubEnv("TAKEOVER_MOCK", "1");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("upload", () => {
  it("stores rows as the user's data, with the uploader, upload time and the file kept privately", async () => {
    const { repo, user } = await person("ana@data.test");
    queries.length = 0;
    const result = await upload(repo);
    expect(result).toMatchObject({ rows: 5, dropped: 1 });
    const d = (await repo.datasets.get(result.id))!;
    expect(d).toMatchObject({ source: "user", uploadedBy: user.id, name: SECRET_NAME, fileKind: "csv", cityColumn: "metro_name", countryColumn: "country" });
    expect(d.uploadedAt).toBeInstanceOf(Date);
    expect(d.metrics.map((m) => m.label)).toEqual(["Tickets sold", "Revenue"]);
    expect(store.has(d.fileKey)).toBe(true);
    expect(d.fileKey).toContain(`datasets/${repo.context.workspaceId}/`);

    const rows = await repo.datasets.rows(result.id);
    expect(rows.every((r) => r.source === "user" && r.workspaceId === repo.context.workspaceId)).toBe(true);
    const la = rows.find((r) => r.rawCity === "Los Angeles")!;
    expect(la).toMatchObject({ matchStatus: "matched", metrics: { m2: 987654, m3: 123456.78 } });
    const brooklyn = rows.find((r) => r.rawCity === "Brooklyn")!;
    expect(brooklyn.matchNote).toMatch(/counted in New York City/);
    expect(brooklyn.metrics.m3).toBeNull();
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("puts unmatched and ambiguous cities in a review list, out of the ranking until a person decides", async () => {
    const { repo } = await person("bo@data.test");
    const { id } = await upload(repo);
    const view = (await datasetView(repo, id, async () => []))!;
    expect(view.review.map((r) => [r.rawCity, r.status])).toEqual([
      ["Springfield", "ambiguous"],
      ["Zzxq Town", "unmatched"],
    ]);
    expect(view.review[0].options.map((o) => o.admin1)).toEqual(["Missouri", "Massachusetts", "Illinois"]);
    expect(view.summary).toMatchObject({ rows: 5, matchedRows: 3, review: 2 });
    const before = metricByCity(await repo.datasets.rows(id), "m2").map((m) => m.value);
    expect(before).not.toContain(4321);

    await repo.datasets.resolveCity(id, "Springfield", "US", view.review[0].options[0].id);
    await repo.datasets.resolveCity(id, "Zzxq Town", "US", null);
    const after = (await datasetView(repo, id, async () => []))!;
    expect(after.review).toEqual([]);
    expect(metricByCity(await repo.datasets.rows(id), "m2").map((m) => m.value)).toContain(4321);
    expect((await repo.datasets.rows(id)).find((r) => r.rawCity === "Zzxq Town")!.matchStatus).toBe("skipped");
  });

  it("rejects a mapping without one city column and a metric, and keeps no file", async () => {
    const { repo } = await person("cy@data.test");
    await expect(ingest(repo, { name: "x.csv", bytes: new TextEncoder().encode(CSV), mapping: { tix: { role: "metric", kind: "tickets" } } }, store)).rejects.toThrow(/exactly one column to City/);
    await expect(ingest(repo, { name: "x.csv", bytes: new TextEncoder().encode(CSV), mapping: { metro_name: { role: "city" } } }, store)).rejects.toThrow(/at least one column to a metric/);
    expect(store.size).toBe(0);
  });
});

describe("attach and combine", () => {
  it("attaches to a fanbase, and its plans combine the plan's Qloo scores with the data", async () => {
    const { repo } = await person("di@data.test");
    const { id } = await upload(repo);
    await repo.datasets.attach(id, PHOEBE);
    expect((await repo.datasets.forEntity(PHOEBE.id))?.id).toBe(id);

    const plan = await runAgent({ query: "Phoebe Bridgers" }, { runId: "data-plan", source: new MockQlooSource(), planner: new ScriptedPlanner(), emit: () => {} });
    const qloo = planCityScores(plan);
    expect(qloo.length).toBeGreaterThan(5);
    const rows = combineCityScores(qloo, metricByCity(await repo.datasets.rows(id), "m2"), 0.5);
    const la = rows.find((r) => r.yours === 1)!;
    expect(la.basis === "both" || la.basis === "yours").toBe(true);
    expect(rows.every((r) => r.weight === 0.5)).toBe(true);
  });
});

describe("privacy", () => {
  it("keeps datasets, rows and files away from every other workspace", async () => {
    const a = await person("eve@data.test");
    const b = await person("fin@data.test");
    const { id } = await upload(a.repo);
    await a.repo.datasets.attach(id, PHOEBE);
    queries.length = 0;

    expect(await b.repo.datasets.list()).toEqual([]);
    expect(await b.repo.datasets.get(id)).toBeNull();
    expect(await b.repo.datasets.rows(id)).toEqual([]);
    expect(await b.repo.datasets.forEntity(PHOEBE.id)).toBeNull();
    expect(await datasetView(b.repo, id, async () => [])).toBeNull();
    await b.repo.datasets.resolveCity(id, "Springfield", "US", null);
    await b.repo.datasets.attach(id, null);
    expect(await deleteDataset(b.repo, id, store)).toBe(false);

    const still = (await a.repo.datasets.get(id))!;
    expect(still.entityId).toBe(PHOEBE.id);
    expect(store.has(still.fileKey)).toBe(true);
    expect((await a.repo.datasets.rows(id)).find((r) => r.rawCity === "Springfield")!.matchStatus).toBe("ambiguous");
    expectAllScoped(queries, TENANT_TABLES);
  });

  it("lets viewers look but not upload, attach or delete", async () => {
    const owner = await person("gil@data.test");
    const viewer = await addUser(db, "hu@data.test");
    const { token } = await owner.repo.invitations.create(viewer.email, "viewer");
    await unscopedAcceptInvitation(db, token, viewer);
    const repo = forWorkspace(db, { userId: viewer.id, workspaceId: owner.workspaceId, role: "viewer" });
    const { id } = await upload(owner.repo);
    expect((await repo.datasets.list()).map((d) => d.id)).toEqual([id]);
    await expect(upload(repo)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(repo.datasets.attach(id, PHOEBE)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(deleteDataset(repo, id, store)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("deletes the rows, the dataset and the file with one call", async () => {
    const { repo } = await person("ida@data.test");
    const { id } = await upload(repo);
    const fileKey = (await repo.datasets.get(id))!.fileKey;
    expect(await deleteDataset(repo, id, store)).toBe(true);
    expect(store.has(fileKey)).toBe(false);
    expect(await repo.datasets.get(id)).toBeNull();
    const [{ n: left }] = await db.select({ n: count() }).from(datasetRows).where(eq(datasetRows.datasetId, id));
    const [{ n: sets }] = await db.select({ n: count() }).from(datasets).where(eq(datasets.id, id));
    expect([left, sets]).toEqual([0, 0]);
  });

  it("never puts the user's data in a prompt to the model, even for a fanbase with data attached", async () => {
    const { repo } = await person("jo@data.test");
    const { id } = await upload(repo);
    await repo.datasets.attach(id, PHOEBE);

    // A model that records every prompt it is given: system prompts, user messages, tool results, completions.
    const seen: string[] = [];
    const script = [["resolve_fanbase"], ["choose_format", "find_partners"], ["pick_city"], ["plan_room"], ["write_brief", "draft_outreach"], []];
    const provider: LLMProvider = {
      name: "gemini",
      model: "fake",
      chat(opts: ChatOptions) {
        seen.push(opts.system, JSON.stringify(opts.tools));
        let turn = 0;
        return {
          async send(input: string | readonly ToolResult[]): Promise<ChatTurn> {
            seen.push(typeof input === "string" ? input : JSON.stringify(input));
            const names = script[Math.min(turn++, script.length - 1)];
            return { stopReason: names.length ? "tool_use" : "end_turn", text: "", calls: names.map((name, i) => ({ id: `c${turn}_${i}`, name, input: {} })), usage: { input: 1, output: 1 } };
          },
        };
      },
      async complete(prompt: string) {
        seen.push(prompt);
        return { text: "", refused: false, usage: { input: 1, output: 1 } };
      },
    };
    const plan = await runAgent(
      { query: "Phoebe Bridgers" },
      { runId: "privacy", source: new MockQlooSource(), planner: new LlmPlanner(provider), emit: () => {}, scope: { kind: "workspace", workspaceId: repo.context.workspaceId } },
    );
    expect(plan.city?.chosen).toBeTruthy();
    expect(seen.length).toBeGreaterThan(5);

    const prompts = seen.join("\n");
    const rows = await repo.datasets.rows(id);
    const secrets = [SECRET_NAME, "secret-ticket", "987654", "555111", "333222", "123456.78", "Zzxq", "Tickets sold", "Your data", id];
    for (const s of secrets) expect(prompts, s).not.toContain(s);
    for (const r of rows) for (const v of Object.values(r.metrics)) if (v !== null && v > 999) expect(prompts).not.toContain(String(v));
  });

  it("the agent and model code cannot reach user data: nothing under lib/agent or lib/llm imports it", () => {
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f);
        return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
      });
    for (const f of [...files("lib/agent"), ...files("lib/llm")]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from "@\/lib\/data\//);
      expect(src, f).not.toMatch(/\bdatasets\b|\bdatasetRows\b|dataset_rows/);
      expect(src, f).not.toMatch(/from "@\/lib\/db(\/|")/);
    }
  });
});
