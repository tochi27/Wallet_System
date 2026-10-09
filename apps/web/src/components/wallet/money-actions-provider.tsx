import { useState, type ReactNode } from "react"
import { MoneyActionDialog } from "@/components/wallet/money-action-dialog"
import { MoneyActionsContext, type MoneyAction } from "@/lib/money-actions-context"

export function MoneyActionsProvider({ children }: { children: ReactNode }) {
  const [action, setAction] = useState<MoneyAction | null>(null)

  return (
    <MoneyActionsContext.Provider value={setAction}>
      {children}
      <MoneyActionDialog action={action} onOpenChange={(open) => !open && setAction(null)} />
    </MoneyActionsContext.Provider>
  )
}
