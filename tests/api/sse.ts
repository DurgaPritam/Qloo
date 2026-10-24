import type { AgentEvent } from "@/lib/agent/types";

/** Reads a whole SSE response into its JSON events. */
export async function readEvents(res: Response): Promise<AgentEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((chunk) => chunk.split("\n").find((line) => line.startsWith("data: ")))
    .filter((line): line is string => Boolean(line))
    .map((line) => JSON.parse(line.slice("data: ".length)) as AgentEvent);
}

export function postJson(url: string, body: unknown, ip = "203.0.113.1"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}
