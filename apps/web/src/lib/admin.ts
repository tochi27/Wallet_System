// Formatting shared by the admin pages

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
export const formatDateTime = (value: string | null | undefined) => (value ? dateTime.format(new Date(value)) : "—")

export const tone = {
  good: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  waiting: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  bad: "border-destructive/20 bg-destructive/10 text-destructive",
  quiet: "text-muted-foreground",
}

// "user.unlock_pin" → "Unlocked PIN"
export function actionLabel(action: string) {
  const labels: Record<string, string> = {
    "user.freeze": "Froze account",
    "user.unfreeze": "Unfroze account",
    "user.unlock_pin": "Unlocked PIN",
    "user.tier_change": "Changed tier",
    "kyc.view": "Opened ID check",
    "kyc.approve": "Approved ID check",
    "kyc.reject": "Rejected ID check",
    "deposit.recheck": "Rechecked deposit",
    "withdrawal.recheck": "Rechecked withdrawal",
    "admin.grant": "Granted admin access",
    "admin.revoke": "Revoked admin access",
    "adjustment.request": "Requested adjustment",
    "adjustment.approve": "Approved adjustment",
    "adjustment.reject": "Rejected adjustment",
    "staff.role_change": "Changed staff role",
  }
  return labels[action] ?? action
}

// Who did it: an admin's name, or "Command line" for changes made with the admin scripts
export const actorName = (admin: { name: string } | null) => admin?.name ?? "Command line"

// ID check (tier upgrade) statuses
export const verificationTone = { PENDING: tone.waiting, APPROVED: tone.good, REJECTED: tone.bad } as const
export const verificationLabel = { PENDING: "Waiting", APPROVED: "Approved", REJECTED: "Rejected" } as const
