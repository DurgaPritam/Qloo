import { TIERS } from "@/lib/entitlements";

import { ATTRIBUTION } from "./attribution";

/**
 * The public API's OpenAPI 3.1 description, from the same constants the API uses (tiers,
 * attribution), served at /api/v1/openapi.json and rendered by /developers.
 */
export interface EndpointDoc {
  method: "get" | "post";
  path: string;
  summary: string;
  description: string;
  params: { name: string; in: "query" | "path"; required: boolean; description: string }[];
  body?: { field: string; required: boolean; description: string }[];
  example: string;
}

export const ENDPOINTS: EndpointDoc[] = [
  {
    method: "get",
    path: "/overlap",
    summary: "Fan overlap",
    description: "How strongly each fanbase's fans over-index on the other (Qloo affinity both ways), and the cities where both are strong.",
    params: [
      { name: "a", in: "query", required: true, description: "First name: an artist, comedian, show, podcast, film or team." },
      { name: "b", in: "query", required: true, description: "Second name." },
      { name: "aId", in: "query", required: false, description: "Qloo entity id for a, from a previous choose answer." },
      { name: "bId", in: "query", required: false, description: "Qloo entity id for b." },
    ],
    example: "/overlap?a=Phoebe%20Bridgers&b=PEN15",
  },
  {
    method: "get",
    path: "/fanbases/cities",
    summary: "Fanbase cities",
    description: "Where a fanbase is strongest, market by market, from Qloo heatmaps scored by the engine.",
    params: [
      { name: "q", in: "query", required: true, description: "The fanbase." },
      { name: "entityId", in: "query", required: false, description: "Qloo entity id, from a previous choose answer." },
    ],
    example: "/fanbases/cities?q=John%20Mulaney",
  },
  {
    method: "get",
    path: "/venues",
    summary: "Venue recommendations",
    description: "Who people in a city over-index on, by kind (music, comedy, podcast, brand): who to book there.",
    params: [
      { name: "city", in: "query", required: true, description: "A city name, e.g. Austin or Manchester, UK." },
      { name: "kinds", in: "query", required: false, description: "Comma-separated: music, comedy, podcast, brand. Default music,comedy." },
    ],
    example: "/venues?city=Austin&kinds=music,comedy",
  },
  {
    method: "get",
    path: "/brands/matches",
    summary: "Brand matches",
    description: "Talent, shows and podcasts a brand's fans over-index on, scored by the engine, and the brand's strongest cities.",
    params: [
      { name: "q", in: "query", required: true, description: "The brand." },
      { name: "entityId", in: "query", required: false, description: "Qloo entity id, from a previous choose answer." },
    ],
    example: "/brands/matches?q=Liquid%20Death",
  },
  {
    method: "post",
    path: "/plans",
    summary: "Create a plan (async)",
    description: "Runs the Takeover agent for a fanbase in the background and saves the plan to your workspace. Answers 202 with a job id; poll GET /plans/{planId}.",
    params: [],
    body: [
      { field: "query", required: true, description: "The fanbase." },
      { field: "entityId", required: false, description: "Qloo entity id, to skip the name match." },
    ],
    example: '/plans  {"query": "Phoebe Bridgers"}',
  },
  {
    method: "get",
    path: "/plans/{id}",
    summary: "Get a plan",
    description: "The job's status (queued, running, failed) or, when done, the plan: partner, city, venue and sponsors with their scores, the brief and the outreach drafts.",
    params: [{ name: "id", in: "path", required: true, description: "The planId from POST /plans." }],
    example: "/plans/3f1c…",
  },
];

export function openApiSpec(serverUrl: string) {
  const envelope = {
    type: "object",
    required: ["data", "evidence", "attribution", "meta"],
    properties: {
      data: { description: "The answer. Has status: done, choose (pick an entityId and ask again), none, queued, running or failed." },
      evidence: { description: "The Qloo requests behind the figures and how each figure is computed." },
      attribution: { $ref: "#/components/schemas/Attribution" },
      meta: {
        type: "object",
        properties: {
          endpoint: { type: "string" },
          requestId: { type: "string" },
          mock: { type: "boolean", description: "True only on sample-data deployments." },
          qlooCalls: { type: "integer" },
          quota: { type: "object", properties: { used: { type: "integer" }, limit: { type: "integer" }, resetsAt: { type: "string", format: "date-time" } } },
        },
      },
    },
  };
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of ENDPOINTS) {
    paths[e.path] = {
      ...paths[e.path],
      [e.method]: {
        summary: e.summary,
        description: e.description,
        security: [{ bearer: [] }],
        parameters: e.params.map((p) => ({ name: p.name, in: p.in, required: p.required, description: p.description, schema: { type: "string" } })),
        ...(e.body
          ? { requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: e.body.filter((b) => b.required).map((b) => b.field), properties: Object.fromEntries(e.body.map((b) => [b.field, { type: "string", description: b.description }])) } } } } }
          : {}),
        responses: {
          [e.method === "post" ? "202" : "200"]: { description: "The envelope.", content: { "application/json": { schema: { $ref: "#/components/schemas/Envelope" } } } },
          "400": { $ref: "#/components/responses/Error" },
          "401": { $ref: "#/components/responses/Error" },
          "404": { $ref: "#/components/responses/Error" },
          "429": { $ref: "#/components/responses/Error" },
          "502": { $ref: "#/components/responses/Error" },
        },
      },
    };
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Takeover API",
      version: "1.0.0",
      description: `Event planning signals from Qloo taste data. Every response carries Qloo's attribution, which you must show wherever you display the data. Limits per key: ${Object.values(TIERS)
        .map((t) => `${t.label} ${t.api.perMinute}/min, ${t.api.monthly}/month`)
        .join("; ")} (placeholders to confirm).`,
    },
    servers: [{ url: `${serverUrl}/api/v1` }],
    components: {
      securitySchemes: { bearer: { type: "http", scheme: "bearer", description: "A workspace API key (tk_…), from Settings → API." } },
      schemas: {
        Attribution: { type: "object", required: ["source", "text", "url"], properties: { source: { const: ATTRIBUTION.source }, text: { type: "string" }, url: { type: "string" }, note: { type: "string" } } },
        Envelope: envelope,
        Error: { type: "object", required: ["error", "attribution"], properties: { error: { type: "object", properties: { code: { type: "string" }, message: { type: "string" } } }, attribution: { $ref: "#/components/schemas/Attribution" } } },
      },
      responses: { Error: { description: "An error, with the attribution.", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } } },
    },
    paths,
  };
}
