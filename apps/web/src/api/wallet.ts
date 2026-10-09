import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"

export type TransactionType = "CREDIT" | "DEBIT"
export type TransactionStatus = "PENDING" | "PROCESSING" | "SUCCESSFUL" | "FAILED" | "REVERSED"

// Decimal columns are serialized by the API as strings, e.g. "1250.50"
export type Transaction = {
  id: string
  reference: string
  userId: string
  type: TransactionType
  status: TransactionStatus
  amount: string
  balanceBefore: string
  balanceAfter: string
  description: string | null
  transferId: string | null
  reversalOf: string | null
  timestamp: string
}

export type Balance = {
  balance: string | null
  computed: string
}

export type TransactionPage = {
  items: Transaction[]
  nextCursor: string | null
}

export type TransferResult = {
  transferId: string
  sender: Transaction
  receiver: Transaction
}

export type PeriodTotals = {
  from: string
  to: string
  moneyIn: string
  moneyOut: string
  sent: string
  received: string
  net: string
}

export type WalletStats = {
  days: number
  timezone: string
  current: PeriodTotals
  previous: PeriodTotals
  balance: {
    current: string
    atPeriodStart: string
    change: string
    changePercent: number | null
  }
  // 2 × days entries, oldest first: the previous period, then the current one
  daily: { date: string; moneyIn: string; moneyOut: string }[]
}

export type MoneyInput = { amount: number; description?: string }
export type TransferInput = MoneyInput & { receiverEmail: string }

// Stats are bucketed by calendar day in the viewer's own timezone
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"

export const walletKeys = {
  all: ["wallet"] as const,
  balance: ["wallet", "balance"] as const,
  transactions: (limit: number) => ["wallet", "transactions", { limit }] as const,
  history: (pageSize: number) => ["wallet", "transactions", "history", { pageSize }] as const,
  stats: (days: number) => ["wallet", "stats", { days, timezone: TIMEZONE }] as const,
}

export function getBalance() {
  return api<Balance>("/api/wallet/balance")
}

export function getTransactions({ limit, cursor }: { limit: number; cursor?: string }) {
  const params = new URLSearchParams({ limit: String(limit) })
  if (cursor) params.set("cursor", cursor)
  return api<TransactionPage>(`/api/wallet/transactions?${params}`)
}

export function getStats(days: number) {
  const params = new URLSearchParams({ days: String(days), timezone: TIMEZONE })
  return api<WalletStats>(`/api/wallet/stats?${params}`)
}

const idempotencyHeader = (key: string) => ({ "Idempotency-Key": key })

// Money comes in and goes out through Paystack (api/payments.ts); the API's direct
// /credit and /debit endpoints are for development only
export function transfer(input: TransferInput, idempotencyKey: string) {
  return api<TransferResult>("/api/wallet/transfer", {
    method: "POST",
    body: input,
    headers: idempotencyHeader(idempotencyKey),
  })
}

export function useBalance() {
  return useQuery({ queryKey: walletKeys.balance, queryFn: getBalance })
}

export function useRecentTransactions(limit: number) {
  return useQuery({
    queryKey: walletKeys.transactions(limit),
    queryFn: () => getTransactions({ limit }),
  })
}

// Keeps the previous period on screen while a new one loads, so switching periods doesn't flash
export function useWalletStats(days: number) {
  return useQuery({
    queryKey: walletKeys.stats(days),
    queryFn: () => getStats(days),
    placeholderData: keepPreviousData,
  })
}

export function useTransactionHistory(pageSize = 20) {
  return useInfiniteQuery({
    queryKey: walletKeys.history(pageSize),
    queryFn: ({ pageParam }) => getTransactions({ limit: pageSize, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  })
}
