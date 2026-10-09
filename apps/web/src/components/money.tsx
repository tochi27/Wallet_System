import { moneyParts } from "@/lib/money"
import { cn } from "@/lib/utils"

type MoneyProps = {
  value: string | number | null | undefined
  hidden?: boolean
  className?: string
  fractionClassName?: string
}

// A money figure with quieter cents, as in "$13,240.05"
export function Money({
  value,
  hidden = false,
  className,
  fractionClassName = "font-normal text-muted-foreground",
}: MoneyProps) {
  if (hidden) {
    return (
      <span className={className}>
        <span aria-hidden>••••••</span>
        <span className="sr-only">Hidden</span>
      </span>
    )
  }
  const { whole, fraction } = moneyParts(value)
  return (
    <span className={cn("whitespace-nowrap", className)}>
      {whole}
      <span className={fractionClassName}>{fraction}</span>
    </span>
  )
}
