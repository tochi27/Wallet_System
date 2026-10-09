import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type DepositStatus = "PENDING" | "SUCCESSFUL" | "FAILED" | "ABANDONED"

export type Deposit = {
  reference: string
  amount: string
  currency: string
  status: DepositStatus
  authorizationUrl: string | null
  channel: string | null
  paidAt: string | null
  failureReason: string | null
  transactionId: string | null
  createdAt: string
}

export type Bank = { name: string; code: string }

export type BankAccount = {
  id: string
  bankCode: string
  bankName: string
  accountNumberLast4: string
  accountName: string
  createdAt: string
}

export type ResolvedAccount = {
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
}

export type WithdrawalStatus = "PROCESSING" | "SUCCESSFUL" | "FAILED" | "REVERSED"

export type Withdrawal = {
  reference: string
  amount: string
  currency: string
  status: WithdrawalStatus
  failureReason: string | null
  bankAccount: { bankName: string; accountNumberLast4: string; accountName: string }
  createdAt: string
  completedAt: string | null
}

// Mirrors apps/api/src/validators/payment.validators.ts
export const MIN_DEPOSIT = 100
export const MIN_WITHDRAWAL = 100
export const MAX_WITHDRAWAL = 5_000_000

export const paymentKeys = {
  all: ["payments"] as const,
  deposit: (reference: string) => ["payments", "deposit", reference] as const,
  banks: ["payments", "banks"] as const,
  bankAccounts: ["payments", "bank-accounts"] as const,
  resolve: (bankCode: string, accountNumber: string) => ["payments", "resolve", bankCode, accountNumber] as const,
  withdrawals: ["payments", "withdrawals"] as const,
}

// Starts a deposit; the response carries the Paystack checkout link to send the user to
export function startDeposit(amount: number, idempotencyKey: string) {
  return api<Deposit>("/api/payments/deposits", {
    method: "POST",
    body: { amount },
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

export function getDeposit(reference: string) {
  return api<Deposit>(`/api/payments/deposits/${encodeURIComponent(reference)}`)
}

const POLL_INTERVAL_MS = 2_000

/**
 * Status of a deposit after the user returns from Paystack. While it's still pending and
 * `polling` is true, re-checks every 2s — each check makes the API ask Paystack. The caller
 * decides how long to keep polling; the webhook and background checks finish the job anyway.
 */
export function useDepositStatus(reference: string | null, polling: boolean) {
  return useQuery({
    queryKey: paymentKeys.deposit(reference ?? ""),
    queryFn: () => getDeposit(reference!),
    enabled: reference !== null,
    staleTime: 0,
    refetchInterval: (query) =>
      polling && (query.state.data?.status ?? "PENDING") === "PENDING" ? POLL_INTERVAL_MS : false,
  })
}

// ── Banks and bank accounts ─────────────────────────────────────────────────

export function getBanks() {
  return api<Bank[]>("/api/payments/banks")
}

export function resolveAccount(bankCode: string, accountNumber: string) {
  return api<ResolvedAccount>("/api/payments/bank-accounts/resolve", {
    method: "POST",
    body: { bankCode, accountNumber },
  })
}

export function addBankAccount(bankCode: string, accountNumber: string) {
  return api<BankAccount>("/api/payments/bank-accounts", { method: "POST", body: { bankCode, accountNumber } })
}

export function removeBankAccount(id: string) {
  return api<Record<string, never>>(`/api/payments/bank-accounts/${encodeURIComponent(id)}`, { method: "DELETE" })
}

// The bank list changes rarely; the API caches it for a day too
export function useBanks() {
  return useQuery({ queryKey: paymentKeys.banks, queryFn: getBanks, staleTime: 60 * 60 * 1000 })
}

export function useBankAccounts() {
  return useQuery({ queryKey: paymentKeys.bankAccounts, queryFn: () => api<BankAccount[]>("/api/payments/bank-accounts") })
}

/**
 * Looks up the account holder once a bank is chosen and 10 digits are entered. Each lookup counts
 * against Paystack limits (3 a day for real banks in test mode), so results are kept and never retried.
 */
export function useResolvedAccount(bankCode: string | null, accountNumber: string) {
  const ready = bankCode !== null && /^\d{10}$/.test(accountNumber)
  return useQuery({
    queryKey: paymentKeys.resolve(bankCode ?? "", accountNumber),
    queryFn: () => resolveAccount(bankCode!, accountNumber),
    enabled: ready,
    staleTime: Infinity,
    retry: false,
  })
}

// ── Withdrawals ─────────────────────────────────────────────────────────────

export function startWithdrawal(bankAccountId: string, amount: number, idempotencyKey: string) {
  return api<Withdrawal>("/api/payments/withdrawals", {
    method: "POST",
    body: { bankAccountId, amount },
    headers: { "Idempotency-Key": idempotencyKey },
  })
}

// Polls while any withdrawal is still on its way, so the status (and any refund) shows up promptly
export function useWithdrawals() {
  return useQuery({
    queryKey: paymentKeys.withdrawals,
    queryFn: () => api<Withdrawal[]>("/api/payments/withdrawals"),
    refetchInterval: (query) => (query.state.data?.some((w) => w.status === "PROCESSING") ? 4_000 : false),
  })
}
