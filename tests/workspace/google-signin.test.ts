import { describe, expect, it } from "vitest";

import { googleConfigured } from "@/lib/auth";

describe("Google sign-in", () => {
  it("is offered only when both halves of the OAuth client are set", () => {
    expect(googleConfigured({ AUTH_GOOGLE_ID: "id.apps.googleusercontent.com", AUTH_GOOGLE_SECRET: "secret" })).toBe(true);
    expect(googleConfigured({ AUTH_GOOGLE_ID: "id.apps.googleusercontent.com" })).toBe(false);
    expect(googleConfigured({ AUTH_GOOGLE_ID: " ", AUTH_GOOGLE_SECRET: "secret" })).toBe(false);
    expect(googleConfigured({})).toBe(false);
  });
});
