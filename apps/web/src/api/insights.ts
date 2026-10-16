import { useQuery } from "@tanstack/react-query"
import { TIMEZONE } from "@/api/wallet"
import { api } from "@/lib/api"
import type { CategoryKey, SpendingCategory } from "@/lib/categories"

// Mirrors apps/api/src/services/insights. Amounts are decimal strings.

export type Insight = {
  kind: "spending" | "category" | "recipient" | "regular" | "unusual" | "tip"
  tone: "positive" | "neutral" | "attention"
  title: string
  body: string
  category?: SpendingCategory
}

type PeriodSummary = { moneyIn: string; spent: string; withdrawn: string; spendCount: number }

export type InsightFacts = {
  period: { from: string; to: string }
  previousPeriod: { from: string; to: string }
  current: PeriodSummary
  previous: PeriodSummary
  spentChangePercent: number | null
  categories: { category: CategoryKey; current: string; previous: string; changePercent: number | null }[]
  topRecipients: { userId: string; name: string; total: string; count: number }[]
  regularPayments: { userId: string; name: string; typicalAmount: string; months: number }[]
  uncategorisedCount: number
}

export type InsightsResponse = {
  enabled: boolean
  refreshing: boolean
  insight: {
    headline: string
    insights: Insight[]
    facts: InsightFacts
    source: "AI" | "TEMPLATE"
    generatedAt: string
  } | null
}

export const insightsKeys = { all: ["insights"] as const }

// While a refresh runs in the background, check back every few seconds until it lands
export function useInsights() {
  return useQuery({
    queryKey: insightsKeys.all,
    queryFn: () => api<InsightsResponse>(`/api/insights?timezone=${encodeURIComponent(TIMEZONE)}`),
    refetchInterval: (query) => (query.state.data?.refreshing ? 4_000 : false),
  })
}

export function refreshInsights() {
  return api<{ refreshing: true }>("/api/insights/refresh", { method: "POST", body: { timezone: TIMEZONE } })
}

export function setTransactionCategory(transactionId: string, category: SpendingCategory) {
  return api<{ id: string; category: SpendingCategory; categorySource: "USER" }>(
    `/api/wallet/transactions/${encodeURIComponent(transactionId)}/category`,
    { method: "PATCH", body: { category } }
  )
}
