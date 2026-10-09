import { useEffect, useMemo, useRef } from "react"
import { Loader2Icon } from "lucide-react"
import { useTransactionHistory, type Transaction } from "@/api/wallet"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionRow, TransactionTableHeader } from "@/components/wallet/transaction-row"
import { errorMessage } from "@/lib/api"
import { formatSignedMoney, toAmount } from "@/lib/money"
import { cn } from "@/lib/utils"

const dayHeading = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" })

type DayGroup = { key: string; label: string; net: number; items: Transaction[] }

// Local calendar day, so a 23:30 transaction lands under the day the user saw it happen
const dayKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
}

// Daily net counts what actually moved the balance: SUCCESSFUL entries, plus REVERSED
// originals (their reversal entry offsets them) — the same rule as /api/wallet/stats
const movesBalance = (tx: Transaction) => tx.status === "SUCCESSFUL" || tx.status === "REVERSED"

function groupByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = []
  for (const tx of items) {
    const key = dayKey(tx.timestamp)
    let group = groups[groups.length - 1]
    if (!group || group.key !== key) {
      group = { key, label: dayHeading.format(new Date(tx.timestamp)), net: 0, items: [] }
      groups.push(group)
    }
    group.items.push(tx)
    if (movesBalance(tx)) group.net += tx.type === "CREDIT" ? toAmount(tx.amount) : -toAmount(tx.amount)
  }
  return groups
}

export function TransactionHistory() {
  const { data, isPending, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useTransactionHistory()
  const sentinel = useRef<HTMLDivElement>(null)

  const groups = useMemo(() => groupByDay(data?.pages.flatMap((page) => page.items) ?? []), [data])

  // Load the next page as the end of the list scrolls into view
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
      },
      { rootMargin: "240px" }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-label="Loading transactions">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-40 w-full rounded-2xl" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex flex-col items-start gap-2 rounded-2xl bg-card p-5 text-sm shadow-soft ring-1 ring-border/70">
        <p className="text-destructive">{errorMessage(error)}</p>
        <Button variant="outline" size="sm" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    )
  }

  if (groups.length === 0) {
    return (
      <p className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground shadow-soft ring-1 ring-border/70">
        No transactions yet. Add money to get started.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <TransactionTableHeader dateLabel="Time" className="-mb-3 px-5" />
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          <div className="mb-2 flex items-center justify-between gap-2 px-1">
            <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
            {group.net !== 0 && (
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums",
                  group.net > 0 ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"
                )}
              >
                <span className="sr-only">Net for the day: </span>
                {formatSignedMoney(group.net)}
              </span>
            )}
          </div>
          <ul className="divide-y rounded-2xl bg-card px-4 shadow-soft ring-1 ring-border/70 lg:px-5">
            {group.items.map((tx) => (
              <TransactionRow key={tx.id} tx={tx} timeOnly />
            ))}
          </ul>
        </section>
      ))}

      <div ref={sentinel} className="flex justify-center py-2">
        {hasNextPage ? (
          <Button variant="ghost" size="sm" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage && <Loader2Icon className="animate-spin" aria-hidden />}
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">That's everything.</p>
        )}
      </div>
    </div>
  )
}
