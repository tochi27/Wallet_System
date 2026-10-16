import { useState } from "react"
import { CheckCircle2Icon, InfoIcon, XCircleIcon } from "lucide-react"
import { Link } from "react-router"
import { useJournal, useLedger, type LedgerAccountSummary } from "@/api/admin"
import { EmptyState, LoadMore, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { Money } from "@/components/money"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDateTime, tone } from "@/lib/admin"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

// What each system account means, in plain words
const ACCOUNT_HELP: Record<string, string> = {
  paystack_clearing: "Money held at Paystack. Deposits add to it; payouts to banks take from it.",
  payouts_in_transit: "Withdrawals sent to banks that Paystack hasn't confirmed yet.",
  adjustments: "Refunds, goodwill credits and corrections. Negative means the business has paid out more than it recovered.",
  dev_funding: "Money created by development-only credits and debits. Should stay at zero in production.",
  opening_balances: "Wallet balances that existed when the ledger started on its first day.",
}

const TYPES = ["", "DEPOSIT", "TRANSFER", "WITHDRAWAL", "WITHDRAWAL_PAID", "WITHDRAWAL_REFUND", "REVERSAL", "ADJUSTMENT", "DIRECT_FUNDING", "OPENING_BALANCE"]
const typeLabel = (t: string) => (t ? t.charAt(0) + t.slice(1).toLowerCase().replace(/_/g, " ") : "All")

export function AdminLedgerPage() {
  const { data, error } = useLedger()
  const [type, setType] = useState("")
  const journal = useJournal(type || undefined)
  const entries = journal.data?.pages.flatMap((p) => p.items) ?? []
  const balanced = data?.trialBalance === "0.00"

  return (
    <div className="flex flex-col gap-5">
      {error ? (
        <p className="text-sm text-destructive">{errorMessage(error)}</p>
      ) : !data ? (
        <Skeleton className="h-40 w-full rounded-3xl" />
      ) : (
        <>
          <div className={cn("flex items-start gap-3 rounded-2xl border p-4 text-sm", balanced ? "border-emerald-600/20 bg-emerald-500/5" : "border-destructive/30 bg-destructive/5")}>
            {balanced ? (
              <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
            ) : (
              <XCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden />
            )}
            <p>
              <span className="font-semibold">Trial balance: {balanced ? "₦0.00, the books balance." : `₦${data.trialBalance}. The books don't balance.`}</span>{" "}
              <span className="text-muted-foreground">
                Every entry's debits equal its credits, which the database enforces, so this sum is always zero.
              </span>
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <AccountCard account={{ code: "wallets", name: `User wallets (${data.userWallets.count})`, type: "LIABILITY", balance: data.userWallets.balance }} help="What PurpleWallet owes its users: the sum of every wallet." />
            {data.accounts.map((account) => (
              <AccountCard key={account.code} account={account} help={ACCOUNT_HELP[account.code]} />
            ))}
          </div>
        </>
      )}

      <Panel
        title="Journal"
        action={
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            aria-label="Filter by entry type"
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {typeLabel(t)}
              </option>
            ))}
          </select>
        }
      >
        {journal.isPending ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : entries.length === 0 ? (
          <EmptyState>No entries yet.</EmptyState>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-5">Entry</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead className="text-right">Debit</TableHead>
                  <TableHead className="pr-5 text-right">Credit</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) =>
                  entry.lines.map((line, i) => (
                    <TableRow key={`${entry.id}-${i}`} className={cn(i === 0 && "border-t-2 border-t-border")}>
                      {i === 0 && (
                        <TableCell className="pl-5 align-top" rowSpan={entry.lines.length}>
                          <ToneBadge className={tone.quiet}>{typeLabel(entry.type)}</ToneBadge>
                          <span className="mt-1 block max-w-60 truncate text-xs" title={entry.description}>
                            {entry.description}
                          </span>
                          <span className="block text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</span>
                        </TableCell>
                      )}
                      <TableCell className={cn(line.credit && "pl-8")}>
                        {line.account.userId ? (
                          <Link to={`/admin/users/${line.account.userId}`} className="hover:underline">
                            {line.account.name}
                          </Link>
                        ) : (
                          line.account.name
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{line.debit && <Money value={line.debit} />}</TableCell>
                      <TableCell className="pr-5 text-right tabular-nums">{line.credit && <Money value={line.credit} />}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            <LoadMore hasMore={journal.hasNextPage} loading={journal.isFetchingNextPage} onClick={() => void journal.fetchNextPage()} />
          </>
        )}
      </Panel>
    </div>
  )
}

function AccountCard({ account, help }: { account: LedgerAccountSummary; help?: string }) {
  const kind = account.type === "ASSET" ? "We hold" : account.type === "LIABILITY" ? "We owe" : "Equity"
  return (
    <div className="rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border/70">
      <p className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
        <span className="truncate">{account.name}</span>
        <span className="shrink-0 text-xs">{kind}</span>
      </p>
      <p className="mt-2 text-xl font-semibold tracking-tight tabular-nums">
        <Money value={account.balance} />
      </p>
      {help && (
        <p className="mt-2 flex gap-1.5 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3 shrink-0" aria-hidden />
          {help}
        </p>
      )}
    </div>
  )
}
