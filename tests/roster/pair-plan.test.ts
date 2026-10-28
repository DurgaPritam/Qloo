import { describe, expect, it } from "vitest";

import { runAgent } from "@/lib/agent/loop";
import { ScriptedPlanner } from "@/lib/agent/planner";
import type { Overrides } from "@/lib/agent/types";
import { MockQlooSource } from "@/lib/qloo/mock";
import type { QlooSource } from "@/lib/qloo/source";

const FANBASE = "mock:seed:phoebe-bridgers:artist";
const PARTNER = "mock:seed:clairo";

const run = (overrides: Overrides, source: QlooSource = new MockQlooSource()) =>
  runAgent({ query: "Phoebe Bridgers" }, { runId: "pair", source, planner: new ScriptedPlanner(), overrides, emit: () => {} });

/** The mock, except the roster partner is only weakly liked by the fanbase's fans. */
function weakPartner(): QlooSource {
  const mock = new MockQlooSource();
  return new Proxy(mock, {
    get(target, prop, receiver) {
      if (prop === "affinityOf") {
        return async (...args: Parameters<QlooSource["affinityOf"]>) => {
          const res = await (target as QlooSource).affinityOf(...args);
          return { ...res, data: res.data && { ...res.data, affinity: 0.2 } };
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

describe("Plan this pairing", () => {
  it("adds the roster partner to the candidates, so it is scored like any other", async () => {
    const plan = await run({ entityId: FANBASE, partnerId: PARTNER, partnerCategory: "artist" });
    expect(plan.partners?.chosenId).toBe(PARTNER);
  });

  it("keeps the roster partner when it would not be shortlisted, at low confidence, and says why", async () => {
    const plan = await run({ entityId: FANBASE, partnerId: PARTNER, partnerCategory: "artist" }, weakPartner());
    expect(plan.partners?.chosenId).toBe(PARTNER);
    const pick = plan.partners?.picks.find((p) => p.pick.entity.id === PARTNER)?.pick;
    expect(pick?.confidence).toBe("low");
    expect(pick?.evidence.affinity).toBe(0.2);
    expect(plan.notes.join(" ")).toMatch(/from your roster.*outside the usual filters/);
  });

  it("without a partner category, an unknown partner falls back to the top pick, as before", async () => {
    const plan = await run({ entityId: FANBASE, partnerId: PARTNER });
    expect(plan.partners?.chosenId).not.toBe(PARTNER);
    expect(plan.notes.join(" ")).toMatch(/no longer shortlisted/);
  });
});
