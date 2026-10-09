import type { TransactionStatus } from "@/api/wallet"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const STATUS: Record<TransactionStatus, { label: string; className: string }> = {
  SUCCESSFUL: {
    label: "Completed",
    className: "border-emerald-600/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  PENDING: {
    label: "Pending",
    className: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  PROCESSING: {
    label: "Processing",
    className: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  FAILED: {
    label: "Failed",
    className: "border-destructive/20 bg-destructive/10 text-destructive",
  },
  REVERSED: {
    label: "Reversed",
    className: "text-muted-foreground",
  },
}

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const { label, className } = STATUS[status]
  return (
    <Badge variant="outline" className={cn("font-normal", className)}>
      {label}
    </Badge>
  )
}
