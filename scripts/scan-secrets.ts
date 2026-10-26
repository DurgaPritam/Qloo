/**
 * Fails (exit 1) if a secret could reach the browser or the repo:
 * - secret values from the environment, or Anthropic-key-shaped strings, anywhere in .next or in
 *   a git-tracked file;
 * - server-only names (QLOO_API_KEY, the X-Api-Key header, ...) in client bundles (.next/static),
 *   which would mean server code was bundled for the browser;
 * - a tracked .env file other than .env.example, or a value filled in .env.example.
 *
 *   npm run build && npm run scan:secrets
 *
 * Findings print the file and line, never the secret itself.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export interface Finding {
  file: string;
  line: number;
  rule: string;
}

export interface Rules {
  /** Exact secret values; only those of 8+ characters are checked. */
  values: string[];
  patterns: Array<{ name: string; re: RegExp }>;
  /** Strings that must not appear at all in this text. */
  forbidden: string[];
}

export const SECRET_ENV = ["QLOO_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "UPSTASH_REDIS_REST_TOKEN"];
export const CLIENT_FORBIDDEN = [...SECRET_ENV, "X-Api-Key"];
export const KEY_PATTERNS = [
  { name: "Anthropic key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "Google API key", re: /AIza[0-9A-Za-z_-]{35}/ },
  // AI Studio's newer key format.
  { name: "Google API key (AQ.)", re: /\bAQ\.[0-9A-Za-z_-]{40,}/ },
];

export function scanText(text: string, file: string, rules: Rules): Finding[] {
  const findings: Finding[] = [];
  const lines = text.split("\n");
  lines.forEach((content, i) => {
    for (const v of rules.values) if (v.length >= 8 && content.includes(v)) findings.push({ file, line: i + 1, rule: "secret value" });
    for (const p of rules.patterns) if (p.re.test(content)) findings.push({ file, line: i + 1, rule: p.name });
    for (const f of rules.forbidden) if (content.includes(f)) findings.push({ file, line: i + 1, rule: `server-only name ${f}` });
  });
  return findings;
}

/** Tracked files that are env files, or an .env.example with a value filled in. */
export function envFileFindings(tracked: string[], read: (file: string) => string): Finding[] {
  const findings: Finding[] = [];
  for (const file of tracked) {
    const base = path.basename(file);
    if (!base.startsWith(".env")) continue;
    if (base !== ".env.example") {
      findings.push({ file, line: 0, rule: "tracked env file" });
      continue;
    }
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*[A-Z0-9_]+\s*=\s*\S/.test(line)) findings.push({ file, line: i + 1, rule: ".env.example has a value" });
      });
  }
  return findings;
}

const TEXT_EXT = /\.(js|mjs|cjs|ts|tsx|json|map|html|css|md|txt|yml|yaml|env|example|rsc|body|meta)$/;

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name !== "cache") walk(full, out);
    } else if (TEXT_EXT.test(name) && st.size < 20_000_000) out.push(full);
  }
  return out;
}

function main() {
  const root = path.resolve(import.meta.dirname, "..");
  const values = SECRET_ENV.map((k) => process.env[k] ?? "").filter(Boolean);
  const findings: Finding[] = [];
  const rel = (f: string) => path.relative(root, f);

  const next = path.join(root, ".next");
  if (!existsSync(next)) console.warn("No .next folder: run `npm run build` first to scan the bundles.");
  for (const file of walk(path.join(next, "static"))) {
    findings.push(...scanText(readFileSync(file, "utf8"), rel(file), { values, patterns: KEY_PATTERNS, forbidden: CLIENT_FORBIDDEN }));
  }
  for (const file of walk(next).filter((f) => !f.startsWith(path.join(next, "static")))) {
    findings.push(...scanText(readFileSync(file, "utf8"), rel(file), { values, patterns: KEY_PATTERNS, forbidden: [] }));
  }

  const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
  findings.push(...envFileFindings(tracked, (f) => readFileSync(path.join(root, f), "utf8")));
  for (const file of tracked.filter((f) => TEXT_EXT.test(f) || !path.extname(f))) {
    const full = path.join(root, file);
    if (!existsSync(full) || statSync(full).size > 5_000_000) continue;
    // This file and its test name the patterns on purpose.
    if (/scan-secrets(\.test)?\.ts$/.test(file)) continue;
    findings.push(...scanText(readFileSync(full, "utf8"), file, { values, patterns: KEY_PATTERNS, forbidden: [] }));
  }

  if (findings.length) {
    console.error(`Secret scan failed with ${findings.length} finding(s):`);
    for (const f of findings) console.error(`  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.rule}`);
    process.exit(1);
  }
  console.log(`Secret scan passed (${values.length} secret value(s) from the environment checked).`);
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) main();
