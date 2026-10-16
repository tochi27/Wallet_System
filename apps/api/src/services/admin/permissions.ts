import { Role } from "@prisma/client";

// What each staff role may do. Higher roles include everything below them. Mirrored in the web
// app (apps/web/src/lib/permissions.ts) to hide buttons, but this is the copy that's enforced.
export const PERMISSIONS = {
  "admin.view": [Role.VIEWER, Role.SUPPORT, Role.FINANCE, Role.OWNER],
  "users.manage": [Role.SUPPORT, Role.FINANCE, Role.OWNER], // freeze, unfreeze, unlock PINs
  "payments.recheck": [Role.SUPPORT, Role.FINANCE, Role.OWNER],
  "kyc.review": [Role.SUPPORT, Role.FINANCE, Role.OWNER], // ID checks for tier upgrades
  "adjustments.manage": [Role.FINANCE, Role.OWNER], // create, approve, reject
  "staff.manage": [Role.OWNER], // grant and revoke staff roles
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export const isStaff = (role: Role | undefined | null) => Boolean(role && role !== Role.USER);

export const can = (role: Role | undefined | null, permission: Permission) =>
  Boolean(role && (PERMISSIONS[permission] as readonly Role[]).includes(role));

export const STAFF_ROLES = [Role.VIEWER, Role.SUPPORT, Role.FINANCE, Role.OWNER] as const;
