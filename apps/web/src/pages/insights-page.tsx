import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Loader2Icon, RefreshCwIcon, RepeatIcon, SparklesIcon, UsersIcon } from "lucide-react"
import { toast } from "sonner"
import { insightsKeys, refreshInsights, useInsights, type InsightFacts } from "@/api/insights"
import { CategoryChart } from "@/components/insights/category-chart"
import { InsightList } from "@/components/insights/insight-list"
import { InsightsOptIn } from "@/components/insights/insights-consent"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { DeltaChip } from "@/components/wallet/delta-chip"
import { StatTile } from "@/components/wallet/stat-tile"
import { errorMessage } from "@/lib/api"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

const cardClass = "rounded-3xl bg-card p-5 shadow-soft ring-1 ring-border/70 md:p-6"
const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })
const updatedAt = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" })
const asDate = (iso: string) => new Date(`${iso}T12:00:00`)

export function InsightsPage() {
  const { data, isPending, error } = useInsights()
  const queryClient = useQueryClient()

  const refresh = useMutation({
    mutationFn: refreshInsights,
    onSuccess: () => {
      toast.success("Refreshing your insights")
      void queryClient.invalidateQueries({ queryKey: insightsKeys.all })
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  const insight = data?.insight
  const busy = data?.refreshing || refresh.isPending

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight md:text-3xl">
            <SparklesIcon className="size-6 text-primary" aria-hidden />
            Insights
          </h1>
          {insight && (
            <p className="mt-1 text-sm text-muted-foreground">
              {shortDate.format(asDate(insight.facts.period.from))} – {shortDate.format(asDate(insight.facts.period.to))}, compared with the 30
              days before
            </p>
          )}
        </div>
        {data?.enabled && (
          <Button variant="outline" className="rounded-full" disabled={busy} onClick={() => refresh.mutate()}>
            {busy ? <Loader2Icon className="animate-spin" aria-hidden /> : <RefreshCwIcon aria-hidden />}
            {busy ? "Refreshing…" : "Refresh"}
          </Button>
        )}
      </div>

      {error ? (
        <div className={cardClass}>
          <p className="text-sm text-destructive">{errorMessage(error)}</p>
        </div>
      ) : isPending ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : !data.enabled ? (
        <div className={cn(cardClass, "max-w-xl")}>
          <InsightsOptIn />
        </div>
      ) : !insight ? (
        <div className={cardClass} role="status">
          <p className="text-sm text-muted-foreground">Preparing your first insights. This takes a few seconds…</p>
          <Skeleton className="mt-4 h-6 w-2/3" />
          <Skeleton className="mt-2 h-4 w-1/2" />
        </div>
      ) : (
        <>
          <Totals facts={insight.facts} />

          <div className="grid items-start gap-5 md:gap-6 xl:grid-cols-5">
            <section className={cn(cardClass, "xl:col-span-3")} aria-labelledby="insights-headline">
              <p id="insights-headline" className="mb-5 text-xl font-semibold tracking-tight">
                {insight.headline}
              </p>
              <InsightList insights={insight.insights} />
              <p className="mt-5 border-t border-border/70 pt-4 text-xs text-muted-foreground">
                {insight.source === "AI"
                  ? "Written by AI from figures PurpleWallet calculated and checked."
                  : "Plain summaries for now: AI wording will be back shortly."}{" "}
                Updated {updatedAt.format(new Date(insight.generatedAt))}.
              </p>
            </section>

            <div className="flex flex-col gap-5 md:gap-6 xl:col-span-2">
              <People facts={insight.facts} />
            </div>
          </div>

          <section className={cardClass} aria-labelledby="categories-title">
            <h2 id="categories-title" className="mb-1 font-semibold">
              Spending by category
            </h2>
            {insight.facts.uncategorisedCount > 0 && (
              <p className="mb-2 text-sm text-muted-foreground">
                {insight.facts.uncategorisedCount} payment{insight.facts.uncategorisedCount === 1 ? " isn't" : "s aren't"} categorised yet.
              </p>
            )}
            {insight.facts.categories.length === 0 ? (
              <p className="py-6 text-sm text-muted-foreground">No spending in the last 60 days.</p>
            ) : (
              <CategoryChart categories={insight.facts.categories} className="mt-3" />
            )}
          </section>
        </>
      )}
    </div>
  )
}

function Totals({ facts }: { facts: InsightFacts }) {
  // Spending going down is the good direction here
  const spent = facts.spentChangePercent
  return (
    <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-3">
      <StatTile
        label="Spent"
        value={facts.current.spent}
        footer={
          spent === null ? (
            <span className="text-xs text-muted-foreground">Nothing spent in the 30 days before</span>
          ) : (
            <>
              <DeltaChip percent={spent} upIsGood={false} />
              <span className="text-xs text-muted-foreground">vs 30 days before</span>
            </>
          )
        }
      />
      <StatTile label="Money in" value={facts.current.moneyIn} footer={<span className="text-xs text-muted-foreground">Deposits and money received</span>} />
      <StatTile
        label="Withdrawn to your bank"
        value={facts.current.withdrawn}
        className="col-span-2 xl:col-span-1"
        footer={<span className="text-xs text-muted-foreground">Not counted as spending</span>}
      />
    </div>
  )
}

function People({ facts }: { facts: InsightFacts }) {
  return (
    <>
      <section className={cardClass} aria-labelledby="top-recipients">
        <h2 id="top-recipients" className="mb-3 flex items-center gap-2 font-semibold">
          <UsersIcon className="size-4 text-primary" aria-hidden />
          People you paid most
        </h2>
        {facts.topRecipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">No transfers to other people in the last 30 days.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border/70 text-sm">
            {facts.topRecipients.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="font-medium">{r.name}</span>
                <span className="text-right tabular-nums">
                  {formatMoney(r.total)}
                  <span className="block text-xs text-muted-foreground">
                    {r.count} payment{r.count === 1 ? "" : "s"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {facts.regularPayments.length > 0 && (
        <section className={cardClass} aria-labelledby="regular-payments">
          <h2 id="regular-payments" className="mb-3 flex items-center gap-2 font-semibold">
            <RepeatIcon className="size-4 text-primary" aria-hidden />
            Regular payments
          </h2>
          <ul className="flex flex-col divide-y divide-border/70 text-sm">
            {facts.regularPayments.map((r) => (
              <li key={r.userId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <span className="font-medium">{r.name}</span>
                <span className="text-right tabular-nums">
                  about {formatMoney(r.typicalAmount)}
                  <span className="block text-xs text-muted-foreground">each month, {r.months} months running</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
