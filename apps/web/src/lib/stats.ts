import { toAmount } from "@/lib/money"

// Percentage change from previous to current. null when there's no base to compare against.
export function percentChange(current: string | number, previous: string | number): number | null {
  const now = toAmount(current)
  const before = toAmount(previous)
  if (before === 0) return now === 0 ? 0 : null
  return ((now - before) / Math.abs(before)) * 100
}

export function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 12) return "Good morning"
  if (hour < 18) return "Good afternoon"
  return "Good evening"
}
