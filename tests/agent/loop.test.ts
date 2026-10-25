import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { runAgent, MAX_TURNS } from "@/lib/agent/loop";
import { AGENT_MODEL, ClaudePlanner, ScriptedPlanner, type Planner } from "@/lib/agent/planner";
import { TO_CONFIRM_SENTENCE } from "@/lib/agent/sanitize";
import type { AgentEvent } from "@/lib/agent/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";

async function run(
  query: string,
  opts: { source?: QlooSource; planner?: Planner; overrides?: Record<string, string>; budget?: number } = {},
) {
  const events: AgentEvent[] = [];
  const plan = await runAgent(
    { query },
    {
      runId: "test",
      source: opts.source ?? new MockQlooSource(),
      planner: opts.planner ?? new ScriptedPlanner(),
      overrides: opts.overrides,
      budget: opts.budget,
      emit: (e) => void events.push(e),
    },
  );
  const settled = events.filter((e) => e.status !== "running");
  return { plan, events, settled };
}

describe("runAgent", () => {
  it("runs the seven steps in order and ends with a final plan", async () => {
    const { plan, events, settled } = await run("John Mulaney");

    expect(settled.map((e) => e.step)).toEqual([
      "identify",
      "format",
      "partners",
      "city",
      "room",
      "brief",
      "outreach",
      "final",
    ]);
    expect(plan.status).toBe("complete");
    expect(plan.format?.format).toBe("tour_stop");
    expect(plan.brief?.title).toContain("John Mulaney");
    expect(events.every((e) => e.mock)).toBe(true);
    for (const step of ["identify", "partners", "city", "room"]) {
      expect(settled.find((e) => e.step === step)?.qlooCall).toMatchObject({ endpoint: expect.any(String) });
    }
    expect(settled.at(-1)?.data).toEqual(plan);
  });

  it("emits running before every settled step event", async () => {
    const { events } = await run("John Mulaney");
    const steps = events.filter((e) => e.step !== "final");
    for (let i = 0; i < steps.length; i += 2) {
      expect(steps[i].status).toBe("running");
      expect(steps[i + 1].step).toBe(steps[i].step);
    }
  });

  it("pauses with needs_input on an ambiguous name, then resumes with overrides.entityId", async () => {
    const first = await run("Mercury");

    expect(first.plan.status).toBe("needs_input");
    expect(first.plan.needsInput?.kind).toBe("ambiguous");
    expect(first.settled.map((e) => e.step)).toEqual(["identify", "identify", "final"]);
    expect(first.settled[1].status).toBe("needs_input");
    const film = first.plan.needsInput!.choices.find((c) => c.category === "movie")!;

    const second = await run("Mercury", { overrides: { entityId: film.entityId } });
    expect(second.plan.status).toBe("complete");
    expect(second.plan.fanbase?.id).toBe(film.entityId);
    expect(second.plan.format?.format).toBe("screening_tour");
  });

  it("offers did-you-mean for a misspelling and a no-match pause for nonsense", async () => {
    const typo = await run("Kevn Hart");
    expect(typo.plan.needsInput).toMatchObject({ kind: "did_you_mean", choices: [{ name: "Kevin Hart" }] });

    const nonsense = await run("xqzvbnmlkj");
    expect(nonsense.plan.needsInput).toMatchObject({ kind: "none", choices: [] });
    expect(nonsense.settled.map((e) => e.step)).toEqual(["identify", "final"]);
  });

  it("emits a fallback branch event and widens when no partner clears the threshold", async () => {
    // First-pass categories return only mega-stars, so nothing passes the popularity band.
    const firstPass = new Set(["artist", "podcast", "tv_show", "movie"]);
    const weak = new MockQlooSource();
    const candidates = weak.candidates.bind(weak);
    weak.candidates = async (...args) => {
      const res = await candidates(...args);
      return firstPass.has(args[1]) ? { ...res, data: res.data.map((c) => ({ ...c, popularity: 0.9999 })) } : res;
    };

    const { plan, settled } = await run("John Mulaney", { source: weak });
    const partnerEvents = settled.filter((e) => e.step === "partners");

    expect(partnerEvents[0]).toMatchObject({
      status: "fallback",
      branch: true,
      summary: "No partner above the threshold, so I'm widening to more categories.",
    });
    expect(partnerEvents).toHaveLength(2);
    expect(plan.partners?.categoriesTried).toHaveLength(6);
    expect(plan.partners?.picks.every((p) => ["brand", "videogame"].includes(p.pick.entity.category))).toBe(true);
    expect(plan.notes).toContain("No partner above the threshold, so I'm widening to more categories.");
    expect(plan.status).toBe("complete");
  });

  it("stops at the turn cap and finishes the rest by code, labelled", async () => {
    const stuck: Planner = {
      kind: "claude",
      next: vi.fn(async () => ({
        stopReason: "tool_use" as const,
        text: "",
        calls: [{ id: "x", name: "resolve_fanbase", input: {} }],
        content: [{ type: "tool_use" as const, id: "x", name: "resolve_fanbase", input: {} }],
      })),
    };

    const { plan } = await run("John Mulaney", { planner: stuck });

    expect(stuck.next).toHaveBeenCalledTimes(MAX_TURNS);
    expect(plan.turns).toBe(MAX_TURNS);
    expect(plan.notes.some((n) => n.includes(`${MAX_TURNS}-turn cap`))).toBe(true);
    expect(plan.status).toBe("complete");
  });

  it("stops calling Qloo at the call budget and labels the gap", async () => {
    const { plan, settled } = await run("John Mulaney", { budget: 3 });

    expect(plan.qlooCalls).toBeLessThanOrEqual(3);
    expect(settled.find((e) => e.step === "partners")).toMatchObject({
      status: "error",
      summary: expect.stringMatching(/3-call Qloo budget/),
    });
    expect(plan.status).toBe("incomplete");
    expect(settled.at(-1)).toMatchObject({ step: "final", status: "fallback" });
  });

  it("applies a partner override", async () => {
    const base = (await run("John Mulaney")).plan;
    const partnerId = base.partners!.picks[1].pick.entity.id;

    const { plan } = await run("John Mulaney", { overrides: { partnerId } });

    expect(plan.partners?.chosenId).toBe(partnerId);
    expect(plan.brief?.items[0].name).toBe(base.partners!.picks[1].pick.entity.name);
  });

  it("applies a city override", async () => {
    const base = (await run("John Mulaney")).plan;
    const cityId = base.city!.table[2].pick.city.id;

    const { plan } = await run("John Mulaney", { overrides: { cityId } });

    expect(plan.city?.chosen?.pick.city.id).toBe(cityId);
    expect(plan.room?.cityName).toBe(base.city!.table[2].pick.city.name);
  });
});

describe("ClaudePlanner", () => {
  function fakeClient(turns: Array<Array<{ name: string; input?: Record<string, unknown> }>>, text = "") {
    let i = 0;
    const create = vi.fn(async () => {
      const calls = turns[Math.min(i++, turns.length - 1)];
      return {
        stop_reason: calls.length ? "tool_use" : "end_turn",
        content: [
          ...(text ? [{ type: "text", text }] : []),
          ...calls.map((c, j) => ({ type: "tool_use", id: `t${i}_${j}`, name: c.name, input: c.input ?? {} })),
        ],
      };
    });
    return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
  }

  const SEVEN = [
    [{ name: "resolve_fanbase" }],
    [{ name: "choose_format" }, { name: "find_partners" }],
    [{ name: "pick_city" }],
    [{ name: "plan_room" }],
    [
      {
        name: "write_brief",
        input: {
          headline: "{fanbase} meets {partner} in {city}. The room holds 2,500 people.",
          partnerReason: "Their fans overlap. Tickets go on sale in June.",
        },
      },
    ],
    [{ name: "draft_outreach", input: { partnerSubject: "{fanbase} × {partner}", partnerBody: "Hi {partner}." } }],
  ];

  it("calls claude-sonnet-5-5 with tools, auto tool choice and server-side fallbacks", async () => {
    const { client, create } = fakeClient(SEVEN);
    await run("John Mulaney", { planner: new ClaudePlanner(client) });

    const params = (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(params).toMatchObject({ model: AGENT_MODEL, fallbacks: "default" });
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params).not.toHaveProperty("tool_choice");
    expect((params.tools as Array<{ name: string }>).map((t) => t.name)).toHaveLength(8);
    expect(create).toHaveBeenCalledTimes(6);
  });

  it("keeps the model's prose, fills names from engine data and removes numbers and dates", async () => {
    const { client } = fakeClient(SEVEN);
    const { plan } = await run("John Mulaney", { planner: new ClaudePlanner(client) });

    const partner = plan.partners!.picks[0].pick.entity.name;
    expect(plan.brief?.headline).toBe(`John Mulaney meets ${partner} in ${plan.room!.cityName}. ${TO_CONFIRM_SENTENCE}`);
    expect(plan.brief?.items[0].reason).toBe(`Their fans overlap. ${TO_CONFIRM_SENTENCE}`);
    expect(plan.brief?.templated).toBe(false);
    expect(plan.outreach?.[0]).toMatchObject({ subject: `John Mulaney × ${partner}`, body: `Hi ${partner}.` });
    expect(plan.notes.some((n) => n.includes("to confirm with the promoter"))).toBe(true);
  });

  it("refuses to run tools out of order", async () => {
    const { client } = fakeClient([[{ name: "pick_city" }], []]);
    const { plan, settled } = await run("John Mulaney", { planner: new ClaudePlanner(client) });

    // The out-of-order call is rejected without an event; the model then stopped, so code finished.
    expect(settled[0].step).toBe("identify");
    expect(plan.notes.some((n) => n.includes("finished by code"))).toBe(true);
  });

  it("passes the agent's one-line remark through sanitised", async () => {
    const { client } = fakeClient(SEVEN, "Starting with 3 searches.");
    const { events } = await run("John Mulaney", { planner: new ClaudePlanner(client) });
    expect(events.some((e) => e.note)).toBe(false);

    const { client: chatty } = fakeClient(SEVEN, "Let me find the fanbase first.");
    const second = await run("John Mulaney", { planner: new ClaudePlanner(chatty) });
    expect(second.events[0].note).toBe("Let me find the fanbase first.");
  });
});


describe("partners exclude the fanbase's own twin records", () => {
  it("never offers a same-name entity as a partner", async () => {
    const twin = new MockQlooSource();
    const candidates = twin.candidates.bind(twin);
    twin.candidates = async (...args) => {
      const res = await candidates(...args);
      return args[1] === "person"
        ? { ...res, data: [...res.data, { ...res.data[0], id: "twin", name: "Phoebe Bridgers", affinity: 0.99, popularity: 0.98 }] }
        : res;
    };
    const { plan } = await run("Phoebe Bridgers", { source: twin });
    expect(plan.partners?.picks.map((p) => p.pick.entity.name)).not.toContain("Phoebe Bridgers");
  });
});
