import { useState } from "react"
import { BarChart3Icon, TableIcon } from "lucide-react"
import type { InsightFacts } from "@/api/insights"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { CATEGORY_META } from "@/lib/categories"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

type Props = { categories: InsightFacts["categories"]; className?: string }

const change = (percent: number | null) =>
  percent === null ? "new" : percent === 0 ? "no change" : `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%`

/**
 * Spending by category, this period against the previous one: paired horizontal bars, one row per
 * category, biggest first. The light "previous" bar is low-contrast on purpose (it's context), so
 * every value is also printed, and a table view gives the exact figures.
 */
export function CategoryChart({ categories, className }: Props) {
  const [view, setView] = useState<"chart" | "table">("chart")
  const max = Math.max(1, ...categories.flatMap((c) => [Number(c.current), Number(c.previous)]))

  return (
    <div className={className}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground" aria-hidden={view === "table"}>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-chart-current" aria-hidden />
            Last 30 days
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] bg-chart-previous" aria-hidden />
            30 days before
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-full"
          onClick={() => setView(view === "chart" ? "table" : "chart")}
          aria-label={view === "chart" ? "Show as table" : "Show as chart"}
        >
          {view === "chart" ? <TableIcon aria-hidden /> : <BarChart3Icon aria-hidden />}
        </Button>
      </div>

      {view === "table" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">Last 30 days</TableHead>
              <TableHead className="text-right">30 days before</TableHead>
              <TableHead className="text-right">Change</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.category}>
                <TableCell>{CATEGORY_META[c.category].label}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(c.current)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(c.previous)}</TableCell>
                <TableCell className="text-right tabular-nums">{change(c.changePercent)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <ul className="flex flex-col gap-1" aria-label="Spending by category, last 30 days and the 30 days before">
          {categories.map((c) => {
            const { label, icon: Icon } = CATEGORY_META[c.category]
            const description = `${label}: ${formatMoney(c.current)} in the last 30 days, ${formatMoney(c.previous)} in the 30 days before (${change(c.changePercent)})`
            return (
              <li
                key={c.category}
                tabIndex={0}
                title={description}
                aria-label={description}
                // Phones: label and amounts on one line, bars full width underneath. Wider: three columns.
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-xl px-2 py-2 outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[11rem_1fr_auto]"
              >
                <span className="flex min-w-0 items-center gap-2 text-sm">
                  <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{label}</span>
                </span>
                {/* Bars grow from a shared left baseline; only the data end is rounded */}
                <span className="col-span-2 row-start-2 flex flex-col gap-0.5 sm:col-span-1 sm:col-start-2 sm:row-start-1" aria-hidden>
                  <span className="h-2.5 rounded-r-[4px] bg-chart-current" style={{ width: `${(Number(c.current) / max) * 100}%` }} />
                  <span className="h-2.5 rounded-r-[4px] bg-chart-previous" style={{ width: `${(Number(c.previous) / max) * 100}%` }} />
                </span>
                <span className="text-right text-sm tabular-nums sm:col-start-3 sm:row-start-1" aria-hidden>
                  <span className="block font-medium">{formatMoney(c.current)}</span>
                  <span className={cn("block text-xs text-muted-foreground")}>
                    {formatMoney(c.previous)} · {change(c.changePercent)}
                  </span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
