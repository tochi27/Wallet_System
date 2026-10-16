import type { ReactNode } from "react"
import { ArrowDownLeftIcon, ArrowLeftIcon, ArrowUpRightIcon, PrinterIcon, Undo2Icon } from "lucide-react"
import { Link, useParams } from "react-router"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { insightsKeys, setTransactionCategory } from "@/api/insights"
import { useTransactionDetail, walletKeys, type Transaction, type TransactionDetail } from "@/api/wallet"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge } from "@/components/wallet/status-badge"
import { errorMessage } from "@/lib/api"
import { CATEGORY_META, SPENDING_CATEGORIES, type SpendingCategory } from "@/lib/categories"
import { formatMoney, formatSignedMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: "full", timeStyle: "short" })

export function ReceiptPage() {
  const { transactionId } = useParams()
  const { data, isPending, isError, error } = useTransactionDetail(transactionId)

  const back = (
    <Button variant="ghost" size="sm" asChild className="self-start print:hidden">
      <Link to="/wallet">
        <ArrowLeftIcon aria-hidden />
        Back to wallet
      </Link>
    </Button>
  )

  if (isPending) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {back}
        <Skeleton className="h-96 w-full rounded-3xl" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
        {back}
        <p className="rounded-3xl bg-card p-8 text-center text-sm text-destructive shadow-soft ring-1 ring-border/70">
          {errorMessage(error)}
        </p>
      </div>
    )
  }

  const { transaction: tx, label, counterparty, deposit, withdrawal, reversedBy, reversalOf } = data
  const isCredit = tx.type === "CREDIT"
  const Icon = tx.reversalOf ? Undo2Icon : isCredit ? ArrowDownLeftIcon : ArrowUpRightIcon

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4">
      {back}

      <article className="rounded-3xl bg-card p-6 shadow-soft ring-1 ring-border/70 sm:p-8 print:shadow-none print:ring-0">
        <header className="flex flex-col items-center gap-3 border-b pb-6 text-center">
          <span
            className={cn(
              "flex size-12 items-center justify-center rounded-full",
              isCredit ? "bg-secondary text-primary" : "bg-muted text-foreground"
            )}
            aria-hidden
          >
            <Icon className="size-5" />
          </span>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className={cn("text-4xl font-semibold tracking-tight", isCredit && tx.status === "SUCCESSFUL" && "text-primary")}>
            {formatSignedMoney(isCredit ? tx.amount : -Number(tx.amount))}
          </p>
          <StatusBadge status={tx.status} />
        </header>

        <dl className="divide-y text-sm">
          <Row label="Date">{fullDate.format(new Date(tx.timestamp))}</Row>
          {tx.description && <Row label="Note">{tx.description}</Row>}
          {counterparty && <Row label={isCredit ? "From" : "To"}>{counterparty.name}</Row>}
          {/* Only money spent has a category: not money in, withdrawals to their own bank, or reversals */}
          {!isCredit && !withdrawal && !tx.reversalOf && tx.status === "SUCCESSFUL" && (
            <Row label="Category">
              <CategoryPicker tx={tx} />
            </Row>
          )}
          {withdrawal && (
            <>
              <Row label="Bank account">
                {withdrawal.bankAccount.bankName} ••{withdrawal.bankAccount.accountNumberLast4}
                <span className="block text-xs text-muted-foreground">{withdrawal.bankAccount.accountName}</span>
              </Row>
              <Row label="Payout">
                {withdrawal.status.charAt(0) + withdrawal.status.slice(1).toLowerCase()}
                {withdrawal.failureReason && (
                  <span className="block text-xs text-muted-foreground">{withdrawal.failureReason}</span>
                )}
              </Row>
              <Row label="Paystack reference" mono>
                {withdrawal.reference}
              </Row>
            </>
          )}
          {deposit && (
            <>
              {deposit.channel && <Row label="Paid by">{deposit.channel.replace(/_/g, " ")}</Row>}
              <Row label="Paystack reference" mono>
                {deposit.reference}
              </Row>
            </>
          )}
          {reversalOf && (
            <Row label="Reverses">
              <Link to={`/transactions/${reversalOf.id}`} className="text-primary underline underline-offset-4">
                {reversalOf.description || "Original transaction"} ({formatMoney(reversalOf.amount)})
              </Link>
            </Row>
          )}
          {reversedBy && (
            <Row label="Reversed by">
              <Link to={`/transactions/${reversedBy.id}`} className="text-primary underline underline-offset-4">
                View reversal
              </Link>
            </Row>
          )}
          {tx.status === "SUCCESSFUL" && (
            <Row label="Balance after">{formatMoney(tx.balanceAfter)}</Row>
          )}
          <Row label="Transaction reference" mono>
            {tx.reference}
          </Row>
        </dl>

        <footer className="mt-6 flex justify-center print:hidden">
          <Button variant="outline" className="rounded-full" onClick={() => window.print()}>
            <PrinterIcon aria-hidden />
            Print or save as PDF
          </Button>
        </footer>
      </article>
    </div>
  )
}

// The user's choice always wins over the AI's suggestion
function CategoryPicker({ tx }: { tx: Transaction }) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (category: SpendingCategory) => setTransactionCategory(tx.id, category),
    onSuccess: ({ category, categorySource }) => {
      queryClient.setQueryData<TransactionDetail>(["wallet", "transaction", tx.id], (old) =>
        old ? { ...old, transaction: { ...old.transaction, category, categorySource } } : old
      )
      void queryClient.invalidateQueries({ queryKey: walletKeys.all, predicate: (q) => q.queryKey[1] !== "transaction" })
      void queryClient.invalidateQueries({ queryKey: insightsKeys.all })
      toast.success(`Category set to ${CATEGORY_META[category].label}`)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  return (
    <>
    <span className="hidden print:inline">{tx.category ? CATEGORY_META[tx.category].label : "Not categorised"}</span>
    <span className="inline-flex flex-col items-end gap-1 print:hidden">
      <select
        aria-label="Category"
        value={tx.category ?? ""}
        disabled={mutation.isPending}
        onChange={(event) => mutation.mutate(event.target.value as SpendingCategory)}
        className="h-8 rounded-lg border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {!tx.category && (
          <option value="" disabled>
            Choose a category
          </option>
        )}
        {SPENDING_CATEGORIES.map((category) => (
          <option key={category} value={category}>
            {CATEGORY_META[category].label}
          </option>
        ))}
      </select>
      {tx.categorySource === "AI" && <span className="text-xs font-normal text-muted-foreground">Suggested by AI</span>}
    </span>
    </>
  )
}

function Row({ label, mono, children }: { label: string; mono?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-6 py-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={cn("min-w-0 text-right font-medium break-words", mono && "font-mono text-xs break-all")}>{children}</dd>
    </div>
  )
}
