import { createContext, useContext } from "react"

export type MoneyAction = "credit" | "debit" | "transfer"

export const MoneyActionsContext = createContext<((action: MoneyAction) => void) | null>(null)

// Opens the add / withdraw / send dialog from anywhere in the app shell
export function useMoneyActions() {
  const open = useContext(MoneyActionsContext)
  if (!open) throw new Error("useMoneyActions must be used inside <MoneyActionsProvider>")
  return open
}
