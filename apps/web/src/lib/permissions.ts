// Mirrors apps/api/src/services/admin/permissions.ts. Only used to hide what a role can't do:
// the API enforces every permission itself.

export type Role = "USER" | "VIEWER" | "SUPPORT" | "FINANCE" | "OWNER"
export const STAFF_ROLES = ["VIEWER", "SUPPORT", "FINANCE", "OWNER"] as const

const PERMISSIONS = {
  "admin.view": ["VIEWER", "SUPPORT", "FINANCE", "OWNER"],
  "users.manage": ["SUPPORT", "FINANCE", "OWNER"],
  "payments.recheck": ["SUPPORT", "FINANCE", "OWNER"],
  "kyc.review": ["SUPPORT", "FINANCE", "OWNER"],
  "adjustments.manage": ["FINANCE", "OWNER"],
  "staff.manage": ["OWNER"],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSIONS

export const isStaff = (role: Role | undefined | null) => Boolean(role && role !== "USER")
export const can = (role: Role | undefined | null, permission: Permission) =>
  Boolean(role && (PERMISSIONS[permission] as readonly Role[]).includes(role))

export const ROLE_INFO: Record<Role, { label: string; description: string }> = {
  USER: { label: "Customer", description: "No admin access" },
  VIEWER: { label: "Viewer", description: "Can see everything in the admin area, but change nothing" },
  SUPPORT: { label: "Support", description: "Viewer, plus freezing accounts, unlocking PINs, rechecking payments and reviewing ID checks" },
  FINANCE: { label: "Finance", description: "Support, plus adjusting balances and approving adjustments" },
  OWNER: { label: "Owner", description: "Everything, plus managing staff roles" },
}
