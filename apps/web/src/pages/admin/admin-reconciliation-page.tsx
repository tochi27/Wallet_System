import { CheckCircle2Icon, InfoIcon, LandmarkIcon, WalletIcon, XCircleIcon } from "lucide-react"
import { Link } from "react-router"
import { useReconciliation } from "@/api/admin"
import { EmptyState, Panel } from "@/components/admin/admin-ui"
import { Money } from "@/components/money"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatTile } from "@/components/wallet/stat-tile"
import { errorMessage } from "@/lib/api"

export function AdminReconciliationPage() {
  const { data, error } = useReconciliation()
  if (error) return <p className="text-sm text-destructive">{errorMessage(error)}</p>

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 md:gap-4">
        <StatTile
          label={data ? `Held in ${data.wallets} wallets` : "Held in wallets"}
          value={data?.totalHeld}
          icon={WalletIcon}
          iconClassName="bg-primary/10 text-primary"
        />
        {data && !data.paystack.available ? (
          <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border/70 sm:p-5">
            <p className="flex items-center gap-2.5 text-sm text-muted-foreground">
              <LandmarkIcon className="size-4" aria-hidden />
              Paystack balance
            </p>
            <p className="mt-3 text-sm">Unavailable: {data.paystack.message}</p>
          </div>
        ) : (
          <StatTile
            label="Paystack balance"
            value={data?.paystack.available ? data.paystack.balance : undefined}
            icon={LandmarkIcon}
            iconClassName="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
          />
        )}
      </div>

      {data && (
        <div className="grid gap-3 sm:grid-cols-2 md:gap-4">
          <StatTile label="Paystack clearing (ledger)" value={data.ledger.paystackClearing} icon={LandmarkIcon} iconClassName="bg-primary/10 text-primary" />
          <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border/70 sm:p-5">
            <p className="text-sm text-muted-foreground">Trial balance</p>
            <p className="mt-3 flex items-center gap-2 text-xl font-semibold sm:text-2xl">
              {data.ledger.trialBalance === "0.00" ? (
                <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
              ) : (
                <XCircleIcon className="size-5 text-destructive" aria-hidden />
              )}
              ₦{data.ledger.trialBalance}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {data.ledger.trialBalance === "0.00" ? "The books balance." : "The books don't balance."}{" "}
              <Link to="/admin/ledger" className="underline">
                Open the ledger
              </Link>
            </p>
          </div>
        </div>
      )}

      <p className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
        In production, the ledger's Paystack clearing should match Paystack's own balance (less what Paystack has
        settled to your bank). In development they differ: the ledger started from opening balances, and direct
        funding creates wallet money with no payment behind it.
      </p>

      <Panel title="Wallets that don't match the ledger">
        {!data ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : data.offLedger.length === 0 ? (
          <EmptyState>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Every wallet's balance matches its ledger account.
            </span>
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">User</TableHead>
                <TableHead className="text-right">Stored</TableHead>
                <TableHead className="text-right">Ledger</TableHead>
                <TableHead className="pr-5 text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.offLedger.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="pl-5">
                    <Link to={`/admin/users/${row.userId}`} className="hover:underline">
                      <span className="block font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">{row.email}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={row.stored} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={row.ledger} />
                  </TableCell>
                  <TableCell className="pr-5 text-right font-medium text-destructive tabular-nums">
                    <Money value={row.difference} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <Panel title="Wallets that don't match their transactions">
        {!data ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : data.mismatches.length === 0 ? (
          <EmptyState>
            <span className="inline-flex items-center gap-2">
              <CheckCircle2Icon className="size-4 text-emerald-600 dark:text-emerald-400" aria-hidden />
              Every wallet's balance matches its transactions.
            </span>
          </EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">User</TableHead>
                <TableHead className="text-right">Stored</TableHead>
                <TableHead className="text-right">From transactions</TableHead>
                <TableHead className="pr-5 text-right">Difference</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.mismatches.map((row) => (
                <TableRow key={row.userId}>
                  <TableCell className="pl-5">
                    <Link to={`/admin/users/${row.userId}`} className="hover:underline">
                      <span className="block font-medium">{row.name}</span>
                      <span className="block text-xs text-muted-foreground">{row.email}</span>
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={row.stored} />
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <Money value={row.computed} />
                  </TableCell>
                  <TableCell className="pr-5 text-right font-medium text-destructive tabular-nums">
                    <Money value={row.difference} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>
    </div>
  )
}
