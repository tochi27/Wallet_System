import { ArrowRightIcon, SparklesIcon } from "lucide-react"
import { Link } from "react-router"
import { useInsights } from "@/api/insights"
import { InsightList } from "@/components/insights/insight-list"
import { InsightsOptIn } from "@/components/insights/insights-consent"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Home page summary: the headline and the first few insights, with a link to the full page
export function InsightsCard({ className }: { className?: string }) {
  const { data, isPending, isError } = useInsights()

  // Insights are a nice-to-have on Home: if they can't load, the card simply isn't shown
  if (isError) return null

  return (
    <section className={cn("rounded-3xl bg-card p-5 shadow-soft ring-1 ring-border/70 md:p-6", className)} aria-labelledby="insights-card-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="insights-card-title" className="flex items-center gap-2 font-semibold">
          <SparklesIcon className="size-4 text-primary" aria-hidden />
          Insights
        </h2>
        {data?.enabled && data.insight && (
          <Link to="/insights" className="flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            See all
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>

      {isPending ? (
        <Skeleton className="h-20 w-full" />
      ) : !data.enabled ? (
        <InsightsOptIn compact />
      ) : !data.insight ? (
        <div className="flex flex-col gap-2" role="status">
          <p className="text-sm text-muted-foreground">Preparing your first insights. This takes a few seconds…</p>
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : (
        <>
          <p className="mb-4 text-lg font-semibold tracking-tight">{data.insight.headline}</p>
          <InsightList insights={data.insight.insights.slice(0, 2)} />
        </>
      )}
    </section>
  )
}
