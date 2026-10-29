import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Claude Design hand-off: reference only, not app code.
    "design/**",
  ]),
  // Rule 3 (docs/roadmap-rules.md): customer data is read through forWorkspace(). Only the
  // files below may touch the raw client or the named unscoped lookups.
  {
    files: ["**/*.ts", "**/*.tsx"],
    // lib/workspace/tier.ts: the one tier lookup the Qloo client needs for each workspace's allowance.
    ignores: ["lib/db/**", "lib/auth.ts", "lib/workspace/context.ts", "lib/workspace/session.ts", "lib/workspace/tier.ts", "tests/**", "scripts/**"],
    rules: {
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/lib/db", message: "Use the scoped repository from lib/workspace/session.ts.", allowTypeImports: true },
            { name: "@/lib/db/unscoped", message: "Cross-workspace lookups live in lib/workspace and lib/auth only." },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
