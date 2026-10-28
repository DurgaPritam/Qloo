import type { Role } from "@/lib/db/schema";

/**
 * What each role may do in a workspace. Every check in lib/db/scoped.ts goes through can().
 * viewer: read. member: also plan, comment, resolve, edit and refresh rosters, upload, attach and delete their data, and add watches. admin: also manage people and any plan's
 * sharing. owner: also rename the workspace and manage admins and owners.
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
  "plan.create": "member",
  "plan.share.own": "member",
  "comment.create": "member",
  "comment.resolve": "member",
  "roster.edit": "member",
  "data.edit": "member",
  "watch.edit": "member",
  "plan.share.any": "admin",
  "member.invite": "admin",
  "member.manage": "admin",
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
