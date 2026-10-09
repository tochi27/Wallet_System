// Decimal values arrive from the API as strings (e.g. "1250.50"). Format them for display
// only — never do arithmetic on them in the browser beyond comparisons and percentages.
// Paystack settles this wallet in naira; VITE_CURRENCY can override the display for other deployments.
const CURRENCY = (import.meta.env.VITE_CURRENCY ?? "NGN").toUpperCase()

function currencyFormatter(options: Intl.NumberFormatOptions = {}) {
  const base: Intl.NumberFormatOptions = {
    style: "currency",
    // "$" rather than "US$" in locales that would otherwise disambiguate
    currencyDisplay: "narrowSymbol",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...options,
  }
  try {
    return new Intl.NumberFormat(undefined, { ...base, currency: CURRENCY })
  } catch {
    // Unknown ISO code in VITE_CURRENCY — fall back rather than crash the app
    return new Intl.NumberFormat(undefined, { ...base, currency: "USD" })
  }
}

const formatter = currencyFormatter()
const compactFormatter = currencyFormatter({ notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 })

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

export function formatMoney(value: string | number | null | undefined): string {
  const n = toNumber(value)
  return n === null ? "—" : formatter.format(n)
}

// e.g. "$12.9K" — for axis ticks and tight spaces
export function formatCompactMoney(value: string | number | null | undefined): string {
  const n = toNumber(value)
  return n === null ? "—" : compactFormatter.format(n)
}

// "+$75.50" / "−$25.00" (true minus sign)
export function formatSignedMoney(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return "—"
  const sign = n > 0 ? "+" : n < 0 ? "−" : ""
  return sign + formatter.format(Math.abs(n))
}

// Splits "$13,240.05" into "$13,240" and ".05" so the cents can be styled quieter
export function moneyParts(value: string | number | null | undefined): { whole: string; fraction: string } {
  const n = toNumber(value)
  if (n === null) return { whole: "—", fraction: "" }
  const parts = formatter.formatToParts(n)
  const decimalAt = parts.findIndex((part) => part.type === "decimal")
  if (decimalAt === -1) return { whole: formatter.format(n), fraction: "" }
  const join = (list: Intl.NumberFormatPart[]) => list.map((part) => part.value).join("")
  return { whole: join(parts.slice(0, decimalAt)), fraction: join(parts.slice(decimalAt)) }
}

export function toAmount(value: string | number | null | undefined): number {
  return toNumber(value) ?? 0
}

// e.g. "$", "₦", "€" — for decorative use where a full amount doesn't fit
export function currencySymbol(): string {
  return formatter.formatToParts(0).find((part) => part.type === "currency")?.value ?? ""
}
