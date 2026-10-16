import { AlertTriangleIcon, ArrowDownLeftIcon, ArrowUpRightIcon, CheckCircle2Icon, LandmarkIcon, UsersIcon } from "lucide-react"
import { Link } from "react-router"
import { useOverview } from "@/api/admin"
import { Panel } from "@/components/admin/admin-ui"
import { Skeleton } from "@/components/ui/skeleton"
import { StatTile } from "@/components/wallet/stat-tile"
import { errorMessage } from "@/lib/api"

export function AdminOverviewPage() {
  const { data, error } = useOverview()
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>

  const attention = data
    ? [
        { count: data.attention.stuckDeposits, label: "deposits pending for over 30 minutes", to: "/admin/payments?tab=deposits&stuck=true" },
        { count: data.attention.stuckWithdrawals, label: "withdrawals processing for over 30 minutes", to: "/admin/payments?tab=withdrawals&stuck=true" },
        { count: data.attention.unprocessedEvents, label: "Paystack events not processed", to: "/admin/events?processed=false" },
        { count: data.attention.pendingAdjustments, label: "balance adjustments waiting for approval", to: "/admin/adjustments" },
        { count: data.attention.pendingVerifications, label: "ID checks waiting for review", to: "/admin/verifications" },
        { count: data.attention.balanceMismatches, label: "wallets whose balance doesn't match their transactions or the ledger", to: "/admin/reconciliation" },
      ].filter((item) => item.count > 0)
    : []

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatTile label="Held in wallets" value={data?.totalHeld} icon={LandmarkIcon} iconClassName="bg-primary/10 text-primary" />
        <StatTile
          label="Deposits, last 24h"
          value={data?.last24Hours.deposits.amount}
          icon={ArrowDownLeftIcon}
          iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          footer={data && <span className="text-xs text-muted-foreground">{data.last24Hours.deposits.count} successful</span>}
        />
        <StatTile
          label="Withdrawals, last 24h"
          value={data?.last24Hours.withdrawals.amount}
          icon={ArrowUpRightIcon}
          iconClassName="bg-amber-500/10 text-amber-600 dark:text-amber-400"
          footer={data && <span className="text-xs text-muted-foreground">{data.last24Hours.withdrawals.count} successful</span>}
        />
        <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border/70 sm:p-5">
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-secondary-foreground" aria-hidden>
              <UsersIcon className="size-4" />
            </span>
            Users
          </div>
          <div className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl">
            {data ? data.users.total.toLocaleString() : <Skeleton className="h-7 w-16" />}
          </div>
          {data && (
            <p className="mt-2 text-xs text-muted-foreground">
              {data.users.frozen} frozen · {data.users.admins} admin{data.users.admins === 1 ? "" : "s"}
            </p>
          )}
        </div>
      </div>

      <Panel title="Needs attention">
        {!data ? (
          <div className="p-5">
            <Skeleton className="h-5 w-64" />
          </div>
        ) : attention.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-muted-foreground">
            <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
            Nothing needs attention right now.
          </p>
        ) : (
          <ul className="divide-y divide-border/70">
            {attention.map((item) => (
              <li key={item.to}>
                <Link to={item.to} className="flex items-center gap-3 px-5 py-4 text-sm transition-colors hover:bg-muted/50">
                  <AlertTriangleIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                  <span>
                    <span className="font-semibold">{item.count}</span> {item.label}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}
