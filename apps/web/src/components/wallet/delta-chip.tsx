import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react"
import { cn } from "@/lib/utils"

type DeltaChipProps = {
  // Percentage change; null means there was nothing to compare against
  percent: number | null
  // Whether "up" is good news (money in) or bad news (money out); null when it's neither
  upIsGood?: boolean | null
  className?: string
}

const TONE = {
  good: { dot: "bg-success/12 text-success", text: "text-success" },
  bad: { dot: "bg-destructive/10 text-destructive", text: "text-destructive" },
  neutral: { dot: "bg-muted text-muted-foreground", text: "text-muted-foreground" },
}

export function DeltaChip({ percent, upIsGood = true, className }: DeltaChipProps) {
  if (percent === null) {
    return <span className={cn("text-xs font-medium text-muted-foreground", className)}>New</span>
  }

  const rounded = Math.round(percent * 10) / 10
  const direction = rounded > 0 ? "up" : rounded < 0 ? "down" : "flat"
  const tone =
    direction === "flat" || upIsGood === null ? "neutral" : (direction === "up") === upIsGood ? "good" : "bad"
  const Icon = direction === "up" ? ArrowUpIcon : direction === "down" ? ArrowDownIcon : MinusIcon

  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}>
      <span className={cn("flex size-5 items-center justify-center rounded-full", TONE[tone].dot)} aria-hidden>
        <Icon className="size-3" strokeWidth={2.5} />
      </span>
      <span className={TONE[tone].text}>
        <span className="sr-only">{direction === "up" ? "Up " : direction === "down" ? "Down " : "No change, "}</span>
        {Math.abs(rounded).toFixed(1)}%
      </span>
    </span>
  )
}
