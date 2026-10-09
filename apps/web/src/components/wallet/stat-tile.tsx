import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { Money } from "@/components/money"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

type StatTileProps = {
  label: string
  value: string | undefined
  icon?: LucideIcon
  iconClassName?: string
  // Optional footer, e.g. a DeltaChip and what it's compared against
  footer?: ReactNode
  hidden?: boolean
  className?: string
}

export function StatTile({ label, value, icon: Icon, iconClassName, footer, hidden, className }: StatTileProps) {
  return (
    <div className={cn("rounded-2xl bg-card p-4 shadow-soft ring-1 ring-border/70 sm:p-5", className)}>
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        {Icon && (
          <span
            className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", iconClassName)}
            aria-hidden
          >
            <Icon className="size-4" />
          </span>
        )}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-3 text-xl font-semibold tracking-tight sm:text-2xl" data-stat-value>
        {value === undefined ? <Skeleton className="h-7 w-28" /> : <Money value={value} hidden={hidden} />}
      </div>
      {footer && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">{footer}</div>}
    </div>
  )
}
