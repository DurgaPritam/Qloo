import { InputError } from "@/lib/db/scoped";
import { normaliseDomain, normaliseOrigins, verifyDomain } from "@/lib/white-label/domain";
import { inFeature, readJson } from "@/lib/workspace/route";

/**
 * POST {domain} sets (or with "" clears) the custom domain; POST {verify: true} checks its TXT
 * record; POST {embedOrigins} sets the sites allowed to frame the widgets (admins).
 */
export async function POST(req: Request): Promise<Response> {
  const body = await readJson(req);
  return inFeature("white.label", async ({ repo }) => {
    if (typeof body.domain === "string") {
      if (!body.domain.trim()) return Response.json(await repo.whiteLabel.setDomain(null));
      const d = normaliseDomain(body.domain);
      if ("error" in d) throw new InputError(d.error);
      return Response.json(await repo.whiteLabel.setDomain(d.domain));
    }
    if (body.verify === true) {
      const row = await repo.whiteLabel.ensure();
      if (!row.domain || !row.domainToken) throw new InputError("Set a domain first.");
      const ok = await verifyDomain(row.domain, row.domainToken);
      if (ok) await repo.whiteLabel.markVerified(new Date());
      return Response.json({ verified: ok });
    }
    if (typeof body.embedOrigins === "string") {
      const o = normaliseOrigins(body.embedOrigins);
      if ("error" in o) throw new InputError(o.error);
      await repo.whiteLabel.setEmbedOrigins(o.origins);
      return Response.json({ embedOrigins: o.origins });
    }
    throw new InputError("Nothing to change.");
  });
}
