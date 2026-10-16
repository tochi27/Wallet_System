import { AlertTriangleIcon, CheckCircle2Icon, SparklesIcon } from "lucide-react"
import type { Insight } from "@/api/insights"
import { CATEGORY_META } from "@/lib/categories"
import { cn } from "@/lib/utils"

// Tone is carried by an icon and its label, never colour alone
const TONE = {
  positive: { icon: CheckCircle2Icon, label: "Good news", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  attention: { icon: AlertTriangleIcon, label: "Worth a look", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  neutral: { icon: SparklesIcon, label: "Insight", className: "bg-primary/10 text-primary" },
} as const

export function InsightList({ insights, className }: { insights: Insight[]; className?: string }) {
  return (
    <ul className={cn("flex flex-col divide-y divide-border/70", className)}>
      {insights.map((insight, index) => {
        const tone = TONE[insight.tone]
        const CategoryIcon = insight.category ? CATEGORY_META[insight.category].icon : null
        return (
          <li key={index} className="flex gap-3 py-3.5 first:pt-0 last:pb-0">
            <span className={cn("flex size-9 shrink-0 items-center justify-center rounded-full", tone.className)}>
              <tone.icon className="size-4" aria-hidden />
              <span className="sr-only">{tone.label}: </span>
            </span>
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                {insight.title}
                {insight.category && CategoryIcon && (
                  <span className="inline-flex items-center gap-1 text-xs font-normal text-muted-foreground">
                    <CategoryIcon className="size-3" aria-hidden />
                    {CATEGORY_META[insight.category].label}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">{insight.body}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
