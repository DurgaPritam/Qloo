import { describe, expect, it } from "vitest";

import { CLIENT_FORBIDDEN, envFileFindings, KEY_PATTERNS, scanText } from "@/scripts/scan-secrets";

describe("scanText", () => {
  const rules = { values: ["real-qloo-key-123"], patterns: KEY_PATTERNS, forbidden: CLIENT_FORBIDDEN };

  it("finds secret values, key-shaped strings and server-only names, with line numbers", () => {
    const text = ["ok", 'fetch(u,{headers:{"X-Api-Key":k}})', "real-qloo-key-123", "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAA"].join("\n");
    expect(scanText(text, "chunk.js", rules)).toEqual([
      { file: "chunk.js", line: 2, rule: "server-only name X-Api-Key" },
      { file: "chunk.js", line: 3, rule: "secret value" },
      { file: "chunk.js", line: 4, rule: "Anthropic key" },
    ]);
  });

  it("passes clean text and ignores short values", () => {
    expect(scanText("const a = 1;", "a.js", { ...rules, values: ["abc"] })).toEqual([]);
  });
});

describe("envFileFindings", () => {
  it("flags tracked env files and filled-in examples", () => {
    const files: Record<string, string> = { ".env.example": "QLOO_API_KEY=\nQLOO_BASE_URL=https://x\n", ".env.local": "" };
    expect(envFileFindings(Object.keys(files), (f) => files[f])).toEqual([
      { file: ".env.example", line: 2, rule: ".env.example has a value" },
      { file: ".env.local", line: 0, rule: "tracked env file" },
    ]);
  });
});
