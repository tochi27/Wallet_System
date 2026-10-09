import { useId, useMemo, useState } from "react"
import { BarChart3Icon, TableIcon } from "lucide-react"
import type { WalletStats } from "@/api/wallet"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { DeltaChip } from "@/components/wallet/delta-chip"
import { formatCompactMoney, formatMoney, toAmount } from "@/lib/money"
import { percentChange } from "@/lib/stats"
import { cn } from "@/lib/utils"

const CHART_HEIGHT = 176
const TICKS = 4

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "short" })
const longDate = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" })
// Noon avoids the date shifting when a YYYY-MM-DD string is read in a timezone west of UTC
const asDate = (isoDate: string) => new Date(`${isoDate}T12:00:00`)

// Rounds the axis top up to a clean step: 1, 2, 2.5 or 5 × 10^n per tick
function niceTop(max: number) {
  if (max <= 0) return TICKS * 25
  const rough = max / TICKS
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude
  return step * TICKS
}

type Day = { date: string; previousDate: string; current: number; previous: number }

/**
 * Money in per day: this week (solid) against the same weekday last week (lighter step).
 * Two series → legend always shown; per-day hover/focus tooltip; table view for exact values.
 */
export function WeeklyChart({ stats, className }: { stats: WalletStats | undefined; className?: string }) {
  const [view, setView] = useState<"chart" | "table">("chart")

  const days = useMemo<Day[]>(() => {
    if (!stats) return []
    const half = stats.daily.length / 2
    const previous = stats.daily.slice(0, half)
    return stats.daily.slice(half).map((day, i) => ({
      date: day.date,
      previousDate: previous[i].date,
      current: toAmount(day.moneyIn),
      previous: toAmount(previous[i].moneyIn),
    }))
  }, [stats])

  return (
    <Card className={cn("rounded-3xl border-0 shadow-soft ring-1 ring-border/70", className)}>
      <CardHeader>
        <CardDescription>Money in · last {stats?.days ?? 7} days</CardDescription>
        <CardTitle className="text-2xl font-semibold tracking-tight">
          {stats ? <Money value={stats.current.moneyIn} /> : <Skeleton className="h-8 w-32" />}
        </CardTitle>
        {stats && (
          <div className="flex items-center gap-2">
            <DeltaChip percent={percentChange(stats.current.moneyIn, stats.previous.moneyIn)} upIsGood />
            <span className="text-xs text-muted-foreground">vs previous {stats.days} days</span>
          </div>
        )}
        <CardAction>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setView(view === "chart" ? "table" : "chart")}
            aria-label={view === "chart" ? "Show as table" : "Show as chart"}
            title={view === "chart" ? "Show as table" : "Show as chart"}
          >
            {view === "chart" ? <TableIcon /> : <BarChart3Icon />}
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!stats ? (
          <Skeleton className="h-52 w-full" />
        ) : view === "table" ? (
          <ChartTable days={days} />
        ) : (
          <Bars days={days} />
        )}
      </CardContent>
    </Card>
  )
}

function Legend() {
  return (
    <div className="mb-4 flex items-center gap-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-chart-current" aria-hidden />
        This week
      </span>
      <span className="flex items-center gap-1.5">
        <span className="size-2.5 rounded-[3px] bg-chart-previous" aria-hidden />
        Last week
      </span>
    </div>
  )
}

function Bars({ days }: { days: Day[] }) {
  const [active, setActive] = useState<number | null>(null)
  const tooltipId = useId()
  const top = niceTop(Math.max(0, ...days.flatMap((d) => [d.current, d.previous])))
  const ticks = Array.from({ length: TICKS + 1 }, (_, i) => (top / TICKS) * (TICKS - i))
  const heightOf = (value: number) => (value <= 0 ? 0 : Math.max(2, (value / top) * CHART_HEIGHT))
  const empty = days.every((d) => d.current === 0 && d.previous === 0)

  return (
    <div>
      <Legend />
      <div className="flex gap-2">
        {/* Y axis: clean, compact ticks in muted ink */}
        <div className="relative w-10 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums" style={{ height: CHART_HEIGHT }} aria-hidden>
          {ticks.map((tick, i) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2" style={{ top: (i / TICKS) * CHART_HEIGHT }}>
              {formatCompactMoney(tick)}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          {/* Hairline gridlines, recessive */}
          <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: CHART_HEIGHT }} aria-hidden>
            {ticks.map((tick, i) => (
              <div
                key={tick}
                className="absolute inset-x-0 h-px bg-chart-grid"
                style={{ top: (i / TICKS) * CHART_HEIGHT }}
              />
            ))}
          </div>

          <div className="relative grid grid-cols-7" role="list" aria-label="Money in per day, this week and last week">
            {days.map((day, i) => {
              const label = `${longDate.format(asDate(day.date))}: ${formatMoney(day.current)}. Same day last week (${longDate.format(asDate(day.previousDate))}): ${formatMoney(day.previous)}.`
              const isActive = active === i
              return (
                <div
                  key={day.date}
                  role="listitem"
                  tabIndex={0}
                  aria-label={label}
                  aria-describedby={isActive ? tooltipId : undefined}
                  onPointerEnter={() => setActive(i)}
                  onPointerLeave={() => setActive(null)}
                  onFocus={() => setActive(i)}
                  onBlur={() => setActive(null)}
                  className="group relative flex flex-col items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* The whole day column is the hit target, not just the painted bars */}
                  <div
                    className={cn(
                      "flex w-full items-end justify-center gap-0.5 rounded-t-lg transition-colors",
                      isActive && "bg-primary/5"
                    )}
                    style={{ height: CHART_HEIGHT }}
                  >
                    <span
                      className="w-[min(12px,32%)] rounded-t-[4px] bg-chart-previous transition-opacity"
                      style={{ height: heightOf(day.previous), opacity: active !== null && !isActive ? 0.55 : 1 }}
                    />
                    <span
                      className="w-[min(12px,32%)] rounded-t-[4px] bg-chart-current transition-opacity"
                      style={{ height: heightOf(day.current), opacity: active !== null && !isActive ? 0.55 : 1 }}
                    />
                  </div>
                  <span
                    className={cn(
                      "mt-2 text-[11px]",
                      i === days.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"
                    )}
                    aria-hidden
                  >
                    {i === days.length - 1 ? "Today" : weekday.format(asDate(day.date))}
                  </span>

                  {isActive && (
                    <div
                      id={tooltipId}
                      role="tooltip"
                      className={cn(
                        "pointer-events-none absolute bottom-full z-10 mb-1 w-max min-w-36 rounded-xl bg-popover px-3 py-2.5 text-xs shadow-lg ring-1 ring-border",
                        i < 2 ? "left-0" : i > 4 ? "right-0" : "left-1/2 -translate-x-1/2"
                      )}
                    >
                      <TooltipRow color="bg-chart-current" value={day.current} label={longDate.format(asDate(day.date))} />
                      <TooltipRow color="bg-chart-previous" value={day.previous} label={longDate.format(asDate(day.previousDate))} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
      {empty && (
        <p className="mt-3 text-center text-xs text-muted-foreground">No money came in over the last two weeks.</p>
      )}
    </div>
  )
}

// Values lead, labels follow; a short line key carries the series color
function TooltipRow({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn("h-0.5 w-3 rounded-full", color)} aria-hidden />
      <span className="font-semibold text-popover-foreground tabular-nums">{formatMoney(value)}</span>
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}

function ChartTable({ days }: { days: Day[] }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">Money in per day, this week and the same day last week</caption>
      <thead>
        <tr className="text-left text-xs text-muted-foreground">
          <th className="pb-2 font-medium">Day</th>
          <th className="pb-2 text-right font-medium">This week</th>
          <th className="pb-2 text-right font-medium">Last week</th>
        </tr>
      </thead>
      <tbody className="divide-y">
        {days.map((day) => (
          <tr key={day.date}>
            <td className="py-2">{longDate.format(asDate(day.date))}</td>
            <td className="py-2 text-right tabular-nums">{formatMoney(day.current)}</td>
            <td className="py-2 text-right text-muted-foreground tabular-nums">{formatMoney(day.previous)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
