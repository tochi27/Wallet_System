import { TIMEZONE, type TransactionStatus, type TransactionType } from "@/api/wallet"
import { api } from "@/lib/api"
import type { SpendingCategory } from "@/lib/categories"

// Mirrors apps/api/src/services/assistant/assistant.service.ts

export type ChatTurn = { role: "user" | "assistant"; text: string }

export type AssistantAction =
  | { type: "send_money"; recipientName: string | null; recipientEmail: string | null; amount: number | null }
  | { type: "withdraw"; amount: number | null }

export type AssistantAnswer = {
  answer: string
  transactions: {
    id: string
    type: TransactionType
    status: TransactionStatus
    amount: string
    description: string | null
    timestamp: string
    category: SpendingCategory | null
    counterparty: string | null
  }[]
  action: AssistantAction | null
  fallback: boolean
}

// The conversation lives only in the browser; the server is sent the recent turns each time
export function askAssistant(message: string, history: ChatTurn[]) {
  return api<AssistantAnswer>("/api/assistant", { method: "POST", body: { message, history: history.slice(-10), timezone: TIMEZONE } })
}
