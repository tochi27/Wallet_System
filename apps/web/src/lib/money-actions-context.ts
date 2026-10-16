import { createContext, useContext } from "react"

export type MoneyAction = "credit" | "debit" | "transfer"

// Values to start the form with, e.g. from the assistant's "Send ₦5,000 to Grace" button.
// The user still reviews everything and confirms with their PIN.
export type MoneyActionPrefill = { receiverEmail?: string; amount?: number; description?: string }

export const MoneyActionsContext = createContext<((action: MoneyAction, prefill?: MoneyActionPrefill) => void) | null>(null)

// Opens the add / withdraw / send dialog from anywhere in the app shell
export function useMoneyActions() {
  const open = useContext(MoneyActionsContext)
  if (!open) throw new Error("useMoneyActions must be used inside <MoneyActionsProvider>")
  return open
}
