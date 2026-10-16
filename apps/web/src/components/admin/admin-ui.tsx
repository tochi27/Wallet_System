import type { ReactNode } from "react"
import { Loader2Icon } from "lucide-react"
import type { PaymentStatus } from "@/api/admin"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { tone } from "@/lib/admin"
import { cn } from "@/lib/utils"

const PAYMENT_STATUS: Record<PaymentStatus, { label: string; className: string }> = {
  SUCCESSFUL: { label: "Successful", className: tone.good },
  PENDING: { label: "Pending", className: tone.waiting },
  PROCESSING: { label: "Processing", className: tone.waiting },
  FAILED: { label: "Failed", className: tone.bad },
  REVERSED: { label: "Reversed", className: tone.bad },
  ABANDONED: { label: "Abandoned", className: tone.quiet },
}

export function PaymentBadge({ status }: { status: PaymentStatus }) {
  const { label, className } = PAYMENT_STATUS[status]
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {label}
    </Badge>
  )
}

export function ToneBadge({ className, children }: { className: string; children: ReactNode }) {
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {children}
    </Badge>
  )
}

// A titled card. Tables scroll sideways inside it on narrow screens instead of the page.
export function Panel({ title, action, children, className }: { title?: string; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border/70", className)}>
      {(title || action) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="px-5 py-10 text-center text-sm text-muted-foreground">{children}</p>
}

export function LoadMore({ hasMore, loading, onClick }: { hasMore: boolean; loading: boolean; onClick: () => void }) {
  if (!hasMore) return null
  return (
    <div className="flex justify-center border-t border-border/70 p-3">
      <Button variant="ghost" size="sm" onClick={onClick} disabled={loading}>
        {loading && <Loader2Icon className="animate-spin" aria-hidden />}
        Load more
      </Button>
    </div>
  )
}
