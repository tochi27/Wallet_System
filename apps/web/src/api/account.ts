import { useQuery } from "@tanstack/react-query"
import type { User } from "@/api/auth"
import { api } from "@/lib/api"

// ── Transaction PIN ─────────────────────────────────────────────────────────

export function setPin(password: string, pin: string) {
  return api<{ hasPin: true }>("/api/account/pin", { method: "POST", body: { password, pin } })
}

export function changePin(proof: { currentPin?: string; password?: string }, newPin: string) {
  return api<{ hasPin: true }>("/api/account/pin", { method: "PUT", body: { ...proof, newPin } })
}

// ── Password ────────────────────────────────────────────────────────────────

// Signs out every other session; this one continues with the returned token
export function changePassword(currentPassword: string, newPassword: string) {
  return api<{ token: string }>("/api/account/password", { method: "PUT", body: { currentPassword, newPassword } })
}

// ── Preferences ─────────────────────────────────────────────────────────────

export function savePreferences(preferences: { emailNotifications?: boolean; aiInsightsEnabled?: boolean; timezone?: string }) {
  return api<{ user: User }>("/api/account/preferences", { method: "PATCH", body: preferences })
}

// ── Limits ──────────────────────────────────────────────────────────────────

export type AccountTier = "TIER_1" | "TIER_2"

export const TIER_NAMES: Record<AccountTier, string> = { TIER_1: "Tier 1", TIER_2: "Tier 2" }

// Amounts are naira strings, e.g. "50000.00". balance.max and balance.room are null when there's no cap.
export type Limits = {
  tier: AccountTier
  emailVerified: boolean
  perTransaction: string
  daily: { limit: string; used: string; remaining: string; resetsAt: string }
  balance: { max: string | null; current: string; room: string | null }
}

export const limitsKeys = { all: ["account", "limits"] as const }

export function getLimits() {
  return api<Limits>("/api/account/limits")
}

// Always fresh: a payment made a moment ago changes today's usage
export function useLimits() {
  return useQuery({ queryKey: limitsKeys.all, queryFn: getLimits, staleTime: 0 })
}

// ── Tier upgrade (ID check) ─────────────────────────────────────────────────

export type IdType = "NIN_SLIP" | "NATIONAL_ID" | "DRIVERS_LICENCE" | "PASSPORT" | "VOTERS_CARD"
export type UpgradeStatus = "PENDING" | "APPROVED" | "REJECTED"
export type DocumentKind = "ID_FRONT" | "ID_BACK" | "SELFIE"

// noun is for the middle of a sentence: "Front of your national ID card"
export const ID_TYPES: Record<IdType, { label: string; noun: string; needsBack: boolean; numberLabel: string; numberHint: string }> = {
  NIN_SLIP: { label: "NIN slip", noun: "NIN slip", needsBack: false, numberLabel: "NIN", numberHint: "11 digits" },
  NATIONAL_ID: { label: "National ID card", noun: "national ID card", needsBack: true, numberLabel: "NIN", numberHint: "11 digits" },
  DRIVERS_LICENCE: { label: "Driver's licence", noun: "driver's licence", needsBack: true, numberLabel: "Licence number", numberHint: "As printed on the licence" },
  PASSPORT: { label: "International passport", noun: "passport", needsBack: false, numberLabel: "Passport number", numberHint: "A letter and 8 digits, e.g. A12345678" },
  VOTERS_CARD: { label: "Voter's card", noun: "voter's card", needsBack: true, numberLabel: "VIN", numberHint: "19 characters" },
}

export type UpgradeRequestView = {
  id: string
  status: UpgradeStatus
  idType: IdType
  submittedAt: string
  reviewedAt: string | null
  rejection: { reason: string; label: string; message: string | null } | null
}

export type UpgradeState = { tier: AccountTier; canApply: boolean; latest: UpgradeRequestView | null }

export const upgradeKeys = { status: ["account", "upgrade"] as const }

export function useUpgradeStatus() {
  return useQuery({ queryKey: upgradeKeys.status, queryFn: () => api<UpgradeState>("/api/account/upgrade"), staleTime: 0 })
}

export type UpgradeInput = {
  legalName: string
  dateOfBirth: string
  idType: IdType
  idNumber: string
  files: Partial<Record<DocumentKind, File>>
}

export function submitUpgrade({ files, ...fields }: UpgradeInput) {
  const form = new FormData()
  for (const [key, value] of Object.entries(fields)) form.append(key, value)
  for (const [kind, file] of Object.entries(files)) if (file) form.append(kind, file)
  return api<UpgradeRequestView>("/api/account/upgrade", { method: "POST", body: form })
}

export function useSupportEmail() {
  return useQuery({
    queryKey: ["account", "support"],
    queryFn: () => api<{ email: string }>("/api/account/support"),
    staleTime: Infinity,
  })
}

// ── Notifications ───────────────────────────────────────────────────────────

export type Notification = {
  id: string
  type: string
  title: string
  body: string
  data: { transactionId?: string; reference?: string; device?: string } | null
  readAt: string | null
  createdAt: string
}

export const notificationKeys = { all: ["notifications"] as const }

// Polled so new activity shows up without a refresh; cheap, and within the read rate limit
export function useNotifications() {
  return useQuery({
    queryKey: notificationKeys.all,
    queryFn: () => api<{ items: Notification[]; unreadCount: number }>("/api/account/notifications"),
    refetchInterval: 30_000,
  })
}

export function markNotificationRead(id: string) {
  return api<Record<string, never>>(`/api/account/notifications/${encodeURIComponent(id)}/read`, { method: "POST" })
}

export function markAllNotificationsRead() {
  return api<Record<string, never>>("/api/account/notifications/read-all", { method: "POST" })
}

// Where a notification should take the user when clicked
export function notificationLink(notification: Notification): string {
  if (notification.data?.transactionId) return `/transactions/${notification.data.transactionId}`
  if (notification.type.startsWith("security.")) return "/settings"
  return "/wallet"
}
