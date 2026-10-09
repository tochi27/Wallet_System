import { Link } from "react-router"
import { useRecentTransactions } from "@/api/wallet"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TransactionRow, TransactionTableHeader } from "@/components/wallet/transaction-row"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const RECENT_LIMIT = 6

export function RecentTransactions({ className }: { className?: string }) {
  const { data, isPending, isError, error, refetch } = useRecentTransactions(RECENT_LIMIT)

  return (
    <Card className={cn("rounded-3xl border-0 shadow-soft ring-1 ring-border/70", className)}>
      <CardHeader>
        <CardTitle>Recent activity</CardTitle>
        <CardDescription>Your latest transactions</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/wallet">See all</Link>
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <ul className="divide-y" aria-label="Loading transactions">
            {Array.from({ length: 3 }, (_, i) => (
              <li key={i} className="flex items-center gap-3 py-3">
                <Skeleton className="size-10 rounded-full" />
                <div className="flex flex-1 flex-col gap-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
                <Skeleton className="h-4 w-16" />
              </li>
            ))}
          </ul>
        ) : isError ? (
          <div className="flex flex-col items-start gap-2 py-2 text-sm">
            <p className="text-destructive">{errorMessage(error)}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : data.items.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No transactions yet. Add money to get started.</p>
        ) : (
          <>
            <TransactionTableHeader className="border-b" />
            <ul className="divide-y">
              {data.items.map((tx) => (
                <TransactionRow key={tx.id} tx={tx} />
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
