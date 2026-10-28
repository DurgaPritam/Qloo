import { describe, expect, it } from "vitest";

import { signQstash, verifyQstashSignature } from "@/lib/jobs/qstash";
import { queueMode } from "@/lib/jobs/queue";

const url = "https://takeover.example/api/jobs/roster-refresh";
const body = JSON.stringify({ kind: "roster.refresh", jobId: "j1" });
const now = Date.UTC(2026, 10, 3);

describe("QStash signatures", () => {
  it("accepts a signature from the current or the next key", () => {
    expect(verifyQstashSignature(signQstash(body, { url, key: "current", now }), body, { url, keys: ["current", "next"], now })).toBe(true);
    expect(verifyQstashSignature(signQstash(body, { url, key: "next", now }), body, { url, keys: ["current", "next"], now })).toBe(true);
  });

  it("refuses a wrong key, another body, another URL, an expired token or none", () => {
    const sig = signQstash(body, { url, key: "current", now });
    expect(verifyQstashSignature(sig, body, { url, keys: ["other"], now })).toBe(false);
    expect(verifyQstashSignature(sig, `${body} `, { url, keys: ["current"], now })).toBe(false);
    expect(verifyQstashSignature(sig, body, { url: `${url}x`, keys: ["current"], now })).toBe(false);
    expect(verifyQstashSignature(sig, body, { url, keys: ["current"], now: now + 3_600_000 })).toBe(false);
    expect(verifyQstashSignature(null, body, { url, keys: ["current"], now })).toBe(false);
    expect(verifyQstashSignature("a.b", body, { url, keys: ["current"], now })).toBe(false);
    expect(verifyQstashSignature(sig, body, { url, keys: [undefined], now })).toBe(false);
  });

  it("runs jobs locally, through QStash when configured, and refuses on Vercel without it", () => {
    expect(queueMode({})).toBe("local");
    expect(queueMode({ VERCEL_ENV: "preview" })).toBe("off");
    expect(queueMode({ VERCEL_ENV: "production", QSTASH_TOKEN: "t", APP_URL: "https://x" })).toBe("qstash");
  });
});
