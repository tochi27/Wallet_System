import { useCallback, useState, type ReactNode } from "react"
import { MoneyActionDialog } from "@/components/wallet/money-action-dialog"
import { MoneyActionsContext, type MoneyAction, type MoneyActionPrefill } from "@/lib/money-actions-context"

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ action: MoneyAction; prefill?: MoneyActionPrefill } | null>(null)
  const open = useCallback((action: MoneyAction, prefill?: MoneyActionPrefill) => setState({ action, prefill }), [])

  return (
    <MoneyActionsContext.Provider value={open}>
      {children}
      <MoneyActionDialog action={state?.action ?? null} prefill={state?.prefill} onOpenChange={(isOpen) => !isOpen && setState(null)} />
    </MoneyActionsContext.Provider>
  )
}
