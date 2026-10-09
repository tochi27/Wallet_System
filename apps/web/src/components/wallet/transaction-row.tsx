import { ArrowDownLeftIcon, ArrowUpRightIcon, Undo2Icon } from "lucide-react"
import type { Transaction } from "@/api/wallet"
import { StatusBadge } from "@/components/wallet/status-badge"
import { formatSignedMoney } from "@/lib/money"
import { transactionLabel } from "@/lib/transactions"
import { cn } from "@/lib/utils"

const timeFormatter = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })

// Desktop (lg+) table columns: description · date · status · amount. Shared with the header row.
const TABLE_COLUMNS = "lg:grid lg:grid-cols-[minmax(0,1fr)_10rem_7.5rem_8.5rem] lg:gap-4"

type TransactionRowProps = {
  tx: Transaction
  // Inside a day group the date is already in the heading, so show only the time
  timeOnly?: boolean
}

export function TransactionRow({ tx, timeOnly = false }: TransactionRowProps) {
  const isCredit = tx.type === "CREDIT"
  const label = transactionLabel(tx)
  const Icon = tx.reversalOf ? Undo2Icon : isCredit ? ArrowDownLeftIcon : ArrowUpRightIcon
  const settled = tx.status === "SUCCESSFUL"
  const when = (timeOnly ? timeFormatter : dateTimeFormatter).format(new Date(tx.timestamp))

  return (
    <li className={cn("flex items-center gap-3 py-3", TABLE_COLUMNS, "lg:items-center")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-full",
            isCredit ? "bg-secondary text-primary" : "bg-muted text-foreground"
          )}
          aria-hidden
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{tx.description || label}</p>
          {/* Phones: "Type · time" under the title. Desktop: the time has its own column. */}
          <p className="truncate text-xs text-muted-foreground lg:hidden">
            {tx.description ? `${label} · ` : ""}
            <time dateTime={tx.timestamp}>{when}</time>
          </p>
          {tx.description && <p className="hidden truncate text-xs text-muted-foreground lg:block">{label}</p>}
        </div>
      </div>

      <time dateTime={tx.timestamp} className="hidden text-sm text-muted-foreground lg:block">
        {when}
      </time>
      <span className="hidden lg:block">
        <StatusBadge status={tx.status} />
      </span>

      <div className="flex shrink-0 flex-col items-end gap-1">
        <span
          className={cn(
            "text-sm font-semibold tabular-nums",
            isCredit && settled && "text-primary",
            !settled && "font-medium text-muted-foreground line-through"
          )}
        >
          <span className="sr-only">{isCredit ? "In: " : "Out: "}</span>
          {formatSignedMoney(isCredit ? tx.amount : -Number(tx.amount))}
        </span>
        {!settled && (
          <span className="lg:hidden">
            <StatusBadge status={tx.status} />
          </span>
        )}
      </div>
    </li>
  )
}

// Column headings for the desktop table layout; hidden on smaller screens
export function TransactionTableHeader({ dateLabel = "Date", className }: { dateLabel?: string; className?: string }) {
  return (
    <div
      className={cn("hidden pb-2 text-xs font-medium text-muted-foreground", TABLE_COLUMNS, className)}
      aria-hidden
    >
      <span>Description</span>
      <span>{dateLabel}</span>
      <span>Status</span>
      <span className="text-right">Amount</span>
    </div>
  )
}
