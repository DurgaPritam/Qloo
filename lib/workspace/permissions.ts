import type { Role } from "@/lib/db/schema";

/**
 * What each role may do in a workspace. Every check in lib/db/scoped.ts goes through can().
 * viewer: read. member: also plan, comment, resolve, edit and refresh rosters, upload, attach and delete their data, add watches, run and shortlist sponsorship matches, log event results, and add and move outreach in the pipeline. admin: also manage people, any plan's
 * sharing, deck branding and the workspace's time zone, currency and Outcomes sample size. owner: also rename the workspace, manage admins and owners, and buy or change the plan (admins see billing).
 */
export type Action =
  | "plan.read"
  | "plan.create"
  | "plan.share.own"
  | "plan.share.any"
  | "comment.read"
  | "comment.create"
  | "comment.resolve"
  | "member.read"
  | "member.invite"
  | "member.manage"
  | "activity.read"
  | "roster.read"
  | "roster.edit"
  | "data.read"
  | "data.edit"
  | "watch.read"
  | "watch.edit"
  | "sponsor.read"
  | "sponsor.edit"
  | "outcome.read"
  | "outcome.log"
  | "pipeline.read"
  | "pipeline.edit"
  | "branding.edit"
  | "workspace.settings"
  | "api.read"
  | "api.manage"
  | "whitelabel.edit"
  | "checklist.dismiss"
  | "billing.read"
  | "billing.manage"
  | "workspace.rename";

const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

const MIN_ROLE: Record<Action, Role> = {
  "plan.read": "viewer",
  "comment.read": "viewer",
  "member.read": "viewer",
  "activity.read": "viewer",
  "roster.read": "viewer",
  "data.read": "viewer",
  "watch.read": "viewer",
  "sponsor.read": "viewer",
  "outcome.read": "viewer",
  "pipeline.read": "viewer",
  "api.read": "member",
  "plan.create": "member",
  "plan.share.own": "member",
  "comment.create": "member",
  "comment.resolve": "member",
  "roster.edit": "member",
  "data.edit": "member",
  "watch.edit": "member",
  "sponsor.edit": "member",
  "outcome.log": "member",
  "pipeline.edit": "member",
  "checklist.dismiss": "member",
  "plan.share.any": "admin",
  "member.invite": "admin",
  "member.manage": "admin",
  "branding.edit": "admin",
  "workspace.settings": "admin",
  "api.manage": "admin",
  "whitelabel.edit": "admin",
  "billing.read": "admin",
  "billing.manage": "owner",
  "workspace.rename": "owner",
};

export function can(role: Role | null | undefined, action: Action): boolean {
  return role ? RANK[role] >= RANK[MIN_ROLE[action]] : false;
}

/** Roles an inviter or manager may hand out: admins up to admin, owners anything. */
export function assignableRoles(role: Role | null | undefined): Role[] {
  if (role === "owner") return ["owner", "admin", "member", "viewer"];
  if (role === "admin") return ["admin", "member", "viewer"];
  return [];
}

/** Whether `actor` may change or remove a member who currently has `target`. */
export function canManage(actor: Role | null | undefined, target: Role): boolean {
  if (!can(actor, "member.manage")) return false;
  return actor === "owner" || target !== "owner";
}

export class ForbiddenError extends Error {
  constructor(public action: string) {
    super(`Not allowed: ${action}`);
    this.name = "ForbiddenError";
  }
}

export const ROLE_LABEL: Record<Role, string> = { owner: "Owner", admin: "Admin", member: "Member", viewer: "Viewer" };
