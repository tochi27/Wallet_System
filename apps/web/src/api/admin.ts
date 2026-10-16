import type { AccountTier, DocumentKind, IdType, UpgradeStatus } from "@/api/account"
import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import type { TransactionStatus, TransactionType } from "@/api/wallet"
import { api } from "@/lib/api"
import type { Role } from "@/lib/permissions"

// Mirrors apps/api/src/services/admin/admin.service.ts. Amounts are decimal strings.

export type Page<T> = { items: T[]; nextCursor: string | null }

export type DepositStatus = "PENDING" | "SUCCESSFUL" | "FAILED" | "ABANDONED"
export type WithdrawalStatus = "PROCESSING" | "SUCCESSFUL" | "FAILED" | "REVERSED"
export type PaymentStatus = DepositStatus | WithdrawalStatus

export type Overview = {
  users: { total: number; frozen: number; admins: number }
  totalHeld: string
  last24Hours: {
    deposits: { count: number; amount: string }
    withdrawals: { count: number; amount: string }
  }
  attention: { stuckDeposits: number; stuckWithdrawals: number; unprocessedEvents: number; balanceMismatches: number; pendingAdjustments: number; pendingVerifications: number }
}

export type AdminUserRow = {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
  frozenAt: string | null
  balance: string
}

type UserSummary = { id: string; name: string; email: string }
type BankSummary = { bankName: string; accountNumberLast4: string; accountName: string }

export type AuditEntry = {
  id: string
  action: string
  targetType: string
  targetId: string
  reason: string
  details: Record<string, unknown> | null
  createdAt: string
  // Null for changes made outside the app, e.g. the admin:grant script
  admin: UserSummary | null
  // The user acted on, when targetType is "User"
  targetUser?: UserSummary | null
}

export type AdminUserDetail = {
  id: string
  name: string
  email: string
  role: Role
  createdAt: string
  emailNotifications: boolean
  passwordChangedAt: string | null
  frozenAt: string | null
  frozenReason: string | null
  // null until they follow the link in their verification email
  emailVerifiedAt: string | null
  tier: AccountTier
  hasPin: boolean
  pinFailedAttempts: number
  pinLockedUntil: string | null
  // Three-way check: stored balance, the sum of transactions and the ledger must agree
  balance: { stored: string; computed: string; ledger: string; matches: boolean }
  adjustments: (Omit<Adjustment, "user" | "requestedBy" | "decidedBy" | "needsSecondAdmin"> & { requestedBy: { name: string }; decidedBy: { name: string } | null })[]
  transactions: { id: string; type: TransactionType; status: TransactionStatus; amount: string; description: string | null; timestamp: string }[]
  deposits: { reference: string; amount: string; status: DepositStatus; channel: string | null; failureReason: string | null; createdAt: string; paidAt: string | null }[]
  withdrawals: { reference: string; amount: string; status: WithdrawalStatus; failureReason: string | null; createdAt: string; completedAt: string | null; bankAccount: BankSummary }[]
  bankAccounts: ({ id: string; createdAt: string } & BankSummary)[]
  devices: { label: string; lastSeenAt: string; createdAt: string }[]
  auditLog: AuditEntry[]
}

export type AdminDeposit = {
  id: string
  reference: string
  amount: string
  status: DepositStatus
  channel: string | null
  failureReason: string | null
  createdAt: string
  paidAt: string | null
  user: UserSummary
}

export type AdminWithdrawal = {
  id: string
  reference: string
  amount: string
  status: WithdrawalStatus
  failureReason: string | null
  createdAt: string
  completedAt: string | null
  user: UserSummary
  bankAccount: BankSummary
}

export type PaystackEventRow = { id: string; event: string; reference: string | null; receivedAt: string; processedAt: string | null }
export type PaystackEventDetail = PaystackEventRow & { eventKey: string; payload: unknown }

export type LedgerAccountSummary = { code: string; name: string; type: "ASSET" | "LIABILITY" | "EQUITY"; balance: string }

export type LedgerSummary = {
  accounts: LedgerAccountSummary[]
  userWallets: { count: number; balance: string }
  trialBalance: string
}

export type Reconciliation = {
  wallets: number
  totalHeld: string
  paystack: { available: true; balance: string } | { available: false; message: string }
  ledger: LedgerSummary & { paystackClearing: string }
  offLedger: { userId: string; name: string; email: string; stored: string; ledger: string; difference: string }[]
  mismatches: { userId: string; name: string; email: string; stored: string; computed: string; difference: string }[]
}

export type RecheckResult = { reference: string; before: PaymentStatus; after: PaymentStatus }

export const adminKeys = {
  all: ["admin"] as const,
  overview: ["admin", "overview"] as const,
  users: (search: string) => ["admin", "users", search] as const,
  user: (id: string) => ["admin", "user", id] as const,
  payments: (kind: "deposits" | "withdrawals", filter: string) => ["admin", kind, filter] as const,
  events: (filter: string) => ["admin", "events", filter] as const,
  event: (id: string) => ["admin", "event", id] as const,
  reconciliation: ["admin", "reconciliation"] as const,
  auditLog: ["admin", "audit-log"] as const,
}

const withQuery = (path: string, params: Record<string, string | number | boolean | undefined>) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `${path}?${text}` : path
}

// One infinite list per filter; "Load more" follows nextCursor
function usePagedList<T>(queryKey: readonly unknown[], path: string, params: Record<string, string | number | boolean | undefined>) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => api<Page<T>>(withQuery(path, { ...params, limit: 25, cursor: pageParam })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  })
}

export const useOverview = () =>
  useQuery({ queryKey: adminKeys.overview, queryFn: () => api<Overview>("/api/admin/overview"), refetchInterval: 60_000 })

export const useAdminUsers = (search: string) => usePagedList<AdminUserRow>(adminKeys.users(search), "/api/admin/users", { search })

export const useAdminUser = (id: string) =>
  useQuery({ queryKey: adminKeys.user(id), queryFn: () => api<AdminUserDetail>(`/api/admin/users/${encodeURIComponent(id)}`) })

export type PaymentFilter = { status?: string; stuck?: boolean; search?: string }

export const useAdminDeposits = (filter: PaymentFilter) =>
  usePagedList<AdminDeposit>(adminKeys.payments("deposits", JSON.stringify(filter)), "/api/admin/deposits", filter)

export const useAdminWithdrawals = (filter: PaymentFilter) =>
  usePagedList<AdminWithdrawal>(adminKeys.payments("withdrawals", JSON.stringify(filter)), "/api/admin/withdrawals", filter)

export type EventFilter = { processed?: boolean; search?: string }

export const usePaystackEvents = (filter: EventFilter) =>
  usePagedList<PaystackEventRow>(adminKeys.events(JSON.stringify(filter)), "/api/admin/paystack-events", filter)

export const usePaystackEvent = (id: string | null) =>
  useQuery({
    queryKey: adminKeys.event(id ?? ""),
    queryFn: () => api<PaystackEventDetail>(`/api/admin/paystack-events/${encodeURIComponent(id ?? "")}`),
    enabled: id !== null,
  })

export const useReconciliation = () =>
  useQuery({ queryKey: adminKeys.reconciliation, queryFn: () => api<Reconciliation>("/api/admin/reconciliation") })

export const useAuditLog = () => usePagedList<AuditEntry>(adminKeys.auditLog, "/api/admin/audit-log", {})

export type UserAction = "freeze" | "unfreeze" | "unlock-pin" | "tier-1" | "tier-2"

export const runUserAction = (id: string, action: UserAction, reason: string) => {
  const path = `/api/admin/users/${encodeURIComponent(id)}`
  if (action === "tier-1" || action === "tier-2") {
    const tier: AccountTier = action === "tier-1" ? "TIER_1" : "TIER_2"
    return api<AdminUserDetail>(`${path}/tier`, { method: "POST", body: { tier, reason } })
  }
  return api<AdminUserDetail>(`${path}/${action}`, { method: "POST", body: { reason } })
}

export const recheckPayment = (kind: "deposits" | "withdrawals", reference: string) =>
  api<RecheckResult>(`/api/admin/${kind}/${encodeURIComponent(reference)}/recheck`, { method: "POST" })

// ── Adjustments, ledger and staff (admin v2) ─────────────────────────────────

export type AdjustmentDirection = "CREDIT" | "DEBIT"
export type AdjustmentKind = "REFUND" | "GOODWILL" | "CORRECTION"
export type AdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED"

export type Adjustment = {
  id: string
  userId: string
  direction: AdjustmentDirection
  kind: AdjustmentKind
  amount: string
  reason: string
  status: AdjustmentStatus
  decisionNote: string | null
  transactionId: string | null
  createdAt: string
  decidedAt: string | null
  needsSecondAdmin: boolean
  user: UserSummary
  requestedBy: UserSummary
  decidedBy: UserSummary | null
}

export type JournalEntry = {
  id: string
  type: string
  description: string
  reference: string | null
  transactionId: string | null
  createdAt: string
  lines: { account: { code: string; name: string; type: string; userId: string | null }; debit: string | null; credit: string | null }[]
}

export type StaffMember = { id: string; name: string; email: string; role: Role; createdAt: string }

export const APPROVAL_THRESHOLD = 10_000

export const useAdjustments = (status?: AdjustmentStatus) =>
  usePagedList<Adjustment>([...adminKeys.all, "adjustments", status ?? "all"], "/api/admin/adjustments", { status })

export const useLedger = () => useQuery({ queryKey: [...adminKeys.all, "ledger"], queryFn: () => api<LedgerSummary>("/api/admin/ledger") })

export const useJournal = (type?: string) =>
  usePagedList<JournalEntry>([...adminKeys.all, "journal", type ?? "all"], "/api/admin/ledger/entries", { type })

export const useStaff = () => useQuery({ queryKey: [...adminKeys.all, "staff"], queryFn: () => api<StaffMember[]>("/api/admin/staff") })

export type AdjustmentInput = { direction: AdjustmentDirection; kind: AdjustmentKind; amount: number; reason: string; password: string }

export const createAdjustment = (userId: string, input: AdjustmentInput) =>
  api<Adjustment>(`/api/admin/users/${encodeURIComponent(userId)}/adjustments`, { method: "POST", body: input })

export const approveAdjustment = (id: string, password: string, note?: string) =>
  api<Adjustment>(`/api/admin/adjustments/${encodeURIComponent(id)}/approve`, { method: "POST", body: { password, note } })

export const rejectAdjustment = (id: string, password: string, reason: string) =>
  api<Adjustment>(`/api/admin/adjustments/${encodeURIComponent(id)}/reject`, { method: "POST", body: { password, reason } })

export const setStaffRole = (userId: string, role: Role, reason: string, password: string) =>
  api<StaffMember>(`/api/admin/users/${encodeURIComponent(userId)}/role`, { method: "PUT", body: { role, reason, password } })

// ── ID checks (tier upgrades) ───────────────────────────────────────────────

export type VerificationListItem = {
  id: string
  status: UpgradeStatus
  legalName: string
  idType: IdType
  idNumberLast4: string
  createdAt: string
  reviewedAt: string | null
  user: { id: string; name: string; email: string }
  reviewedBy: { name: string } | null
}

export type VerificationDetail = {
  id: string
  status: UpgradeStatus
  legalName: string
  dateOfBirth: string
  idType: IdType
  idNumber: string
  rejectionReason: RejectionReason | null
  rejectionLabel: string | null
  reviewMessage: string | null
  reviewedAt: string | null
  reviewedBy: { name: string } | null
  documentsDeletedAt: string | null
  createdAt: string
  user: { id: string; name: string; email: string; createdAt: string; emailVerifiedAt: string | null; tier: AccountTier }
  documents: { id: string; kind: DocumentKind; mimeType: string; size: number }[]
  history: { id: string; status: UpgradeStatus; createdAt: string; rejectionReason: RejectionReason | null }[]
}

export type RejectionReason = "BLURRY_PHOTO" | "NAME_MISMATCH" | "EXPIRED_ID" | "SELFIE_MISMATCH" | "WRONG_DOCUMENT" | "OTHER"

// What the reviewer picks; the API turns it into the sentence the user sees
export const REJECTION_REASONS: Record<RejectionReason, string> = {
  BLURRY_PHOTO: "Photo blurry or too dark",
  NAME_MISMATCH: "Name doesn't match the account",
  EXPIRED_ID: "ID has expired",
  SELFIE_MISMATCH: "Selfie doesn't match the ID photo",
  WRONG_DOCUMENT: "Not the type of ID chosen",
  OTHER: "Something else (explain below)",
}

export const useVerifications = (status: UpgradeStatus) =>
  usePagedList<VerificationListItem>([...adminKeys.all, "verifications", status], "/api/admin/verifications", { status })

export const verificationKey = (id: string) => [...adminKeys.all, "verification", id] as const

export const useVerification = (id: string) =>
  useQuery({ queryKey: verificationKey(id), queryFn: () => api<VerificationDetail>(`/api/admin/verifications/${encodeURIComponent(id)}`) })

export const verificationDocumentPath = (id: string, documentId: string) =>
  `/api/admin/verifications/${encodeURIComponent(id)}/documents/${encodeURIComponent(documentId)}`

export const approveVerification = (id: string) =>
  api<VerificationDetail>(`/api/admin/verifications/${encodeURIComponent(id)}/approve`, { method: "POST" })

export const rejectVerification = (id: string, reason: RejectionReason, message?: string) =>
  api<VerificationDetail>(`/api/admin/verifications/${encodeURIComponent(id)}/reject`, { method: "POST", body: { reason, message } })
