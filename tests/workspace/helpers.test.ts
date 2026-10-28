import { describe, expect, it } from "vitest";

import { localDbTarget } from "@/lib/db";
import { emailConfigured, outboxEnabled } from "@/lib/email/mailer";
import { handlesFor, mentionedUserIds, splitMentions } from "@/lib/workspace/mentions";
import { assignableRoles, can, canManage } from "@/lib/workspace/permissions";

const members = [
  { userId: "a", email: "alex@acme.com", name: "Alex" },
  { userId: "b", email: "alex@gmail.com", name: "Alex G" },
  { userId: "c", email: "Sam.Lee@acme.com", name: null },
];

describe("mentions", () => {
  it("gives every member a unique handle", () => {
    expect([...handlesFor(members).values()]).toEqual(["alex.acme", "alex.gmail", "sam.lee"]);
  });

  it("finds mentioned members, ignoring unknown handles, emails and a trailing full stop", () => {
    expect(mentionedUserIds("@alex.gmail and @sam.lee. Not @nobody or bob@alex.acme", members)).toEqual(["b", "c"]);
  });

  it("marks only real handles for display", () => {
    const parts = splitMentions("hi @sam.lee and @ghost", new Set(["sam.lee"]));
    expect(parts).toEqual([
      { text: "hi ", mention: false },
      { text: "@sam.lee", mention: true },
      { text: " and @ghost", mention: false },
    ]);
  });
});

describe("permissions", () => {
  it("ranks roles", () => {
    expect(can("viewer", "plan.read")).toBe(true);
    expect(can("viewer", "comment.create")).toBe(false);
    expect(can("member", "comment.resolve")).toBe(true);
    expect(can("member", "member.invite")).toBe(false);
    expect(can("admin", "workspace.rename")).toBe(false);
    expect(can(null, "plan.read")).toBe(false);
    expect(assignableRoles("admin")).not.toContain("owner");
    expect(canManage("admin", "owner")).toBe(false);
    expect(canManage("owner", "owner")).toBe(true);
  });
});

describe("environment guards", () => {
  it("never runs the outbox on Vercel, and email then needs Resend", () => {
    expect(outboxEnabled({})).toBe(true);
    expect(outboxEnabled({ VERCEL_ENV: "preview" })).toBe(false);
    expect(outboxEnabled({ RESEND_API_KEY: "x" })).toBe(false);
    expect(emailConfigured({ VERCEL_ENV: "production" })).toBe(false);
    expect(emailConfigured({ VERCEL_ENV: "production", RESEND_API_KEY: "x", EMAIL_FROM: "a@b.c" })).toBe(true);
  });

  it("refuses a local database on Vercel", () => {
    expect(() => localDbTarget({ VERCEL_ENV: "production" })).toThrow(/DATABASE_URL is required/);
    expect(localDbTarget({ DATABASE_URL: "postgres://x" })).toBeNull();
    expect(localDbTarget({ TAKEOVER_DB: "memory" })).toBe("memory://");
  });
});
