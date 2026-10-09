import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { ArrowUpRightIcon, Loader2Icon } from "lucide-react"
import { useWithdrawals, type WithdrawalStatus } from "@/api/payments"
import { walletKeys } from "@/api/wallet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

const VISIBLE = 5
const when = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

const STATUS: Record<WithdrawalStatus, { label: string; className: string }> = {
  PROCESSING: { label: "Processing", className: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  SUCCESSFUL: { label: "Paid", className: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  FAILED: { label: "Failed · refunded", className: "border-destructive/20 bg-destructive/10 text-destructive" },
  REVERSED: { label: "Reversed · refunded", className: "border-destructive/20 bg-destructive/10 text-destructive" },
}

export function WithdrawalsCard({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const { data: withdrawals, isPending, isError, error, refetch } = useWithdrawals()

  // When a withdrawal settles (especially a refund), refresh the balance and history
  const processing = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!withdrawals) return
    const now = new Set(withdrawals.filter((w) => w.status === "PROCESSING").map((w) => w.reference))
    const settled = [...processing.current].some((reference) => !now.has(reference))
    processing.current = now
    if (settled) void queryClient.invalidateQueries({ queryKey: walletKeys.all })
  }, [withdrawals, queryClient])

  return (
    <Card className={cn("rounded-3xl border-0 shadow-soft ring-1 ring-border/70", className)}>
      <CardHeader>
        <CardTitle>Withdrawals</CardTitle>
        <CardDescription>Recent payouts to your bank</CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : isError ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-destructive">{errorMessage(error)}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : withdrawals.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">No withdrawals yet.</p>
        ) : (
          <ul className="divide-y">
            {withdrawals.slice(0, VISIBLE).map((withdrawal) => {
              const status = STATUS[withdrawal.status]
              return (
                <li key={withdrawal.reference} className="flex items-center gap-3 py-3">
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted" aria-hidden>
                    {withdrawal.status === "PROCESSING" ? (
                      <Loader2Icon className="size-4 animate-spin text-muted-foreground" />
                    ) : (
                      <ArrowUpRightIcon className="size-4" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {withdrawal.bankAccount.bankName} ••{withdrawal.bankAccount.accountNumberLast4}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {withdrawal.failureReason ?? when.format(new Date(withdrawal.createdAt))}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="text-sm font-semibold tabular-nums">{formatMoney(withdrawal.amount)}</span>
                    <Badge variant="outline" className={cn("font-normal", status.className)}>
                      {status.label}
                    </Badge>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
