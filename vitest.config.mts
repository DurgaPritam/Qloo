import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    // Tests never call a real model: providers are faked where a test needs one.
    env: { LLM_PROVIDER: "", GEMINI_API_KEY: "", ANTHROPIC_API_KEY: "", LLM_DAILY_TOKEN_BUDGET: "" },
  },
});
