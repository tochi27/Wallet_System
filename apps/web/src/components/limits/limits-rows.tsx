import { ClockIcon, GaugeIcon, WalletIcon } from "lucide-react"
import { Link } from "react-router"
import { TIER_NAMES, useLimits, useUpgradeStatus } from "@/api/account"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { formatMoney, toAmount } from "@/lib/money"
import { cn } from "@/lib/utils"

const resetTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

// How much of a limit is used: the numbers are always written out, so the bar is never the only signal
function Meter({ label, used, limit, caption }: { label: string; used: string; limit: string; caption: string }) {
  const share = Math.min(1, toAmount(used) / Math.max(1, toAmount(limit)))
  return (
    <div className="flex flex-col gap-2 p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-sm">
        <span className="font-medium">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{formatMoney(used)}</span> of {formatMoney(limit)}
        </span>
      </div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={toAmount(limit)}
        aria-valuenow={toAmount(used)}
        aria-valuetext={`${formatMoney(used)} of ${formatMoney(limit)}`}
        className="h-2 overflow-hidden rounded-full bg-muted"
      >
        <div
          className={cn("h-full rounded-full transition-[width]", share >= 0.9 ? "bg-amber-500" : "bg-primary")}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground">{caption}</p>
    </div>
  )
}

/** The rows of the Settings "Limits" card: tier, today's sending allowance and the wallet cap. */
export function LimitsRows() {
  const { data: limits, isPending, error } = useLimits()
  const { data: upgrade } = useUpgradeStatus()
  const pending = upgrade?.latest?.status === "PENDING"
  // An old rejection stops mattering once the user is on Tier 2 (staff can also raise them directly)
  const rejection = upgrade?.tier === "TIER_1" && upgrade.latest?.status === "REJECTED" ? upgrade.latest.rejection : null

  if (isPending) {
    return (
      <div className="flex flex-col gap-3 p-4 sm:p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-2 w-full" />
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-destructive sm:p-5">{errorMessage(error)}</p>

  return (
    <>
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:gap-4 sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <GaugeIcon className="size-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-sm">
            <span className="flex flex-wrap items-center gap-2 font-medium">
              Account level
              <Badge variant="secondary">{TIER_NAMES[limits.tier]}</Badge>
              {pending && (
                <Badge variant="outline">
                  <ClockIcon aria-hidden />
                  ID being checked
                </Badge>
              )}
            </span>
            <span className="mt-0.5 block text-muted-foreground">
              {!limits.emailVerified
                ? "Verify your email to start adding, sending and withdrawing money."
                : pending
                  ? "We're checking your ID for Tier 2, usually within 1 business day."
                  : rejection
                    ? `We couldn't verify your ID: ${rejection.label}.${rejection.message ? ` ${rejection.message}` : ""} You can send it again.`
                    : limits.tier === "TIER_1"
                      ? `Up to ${formatMoney(limits.perTransaction)} per transfer or withdrawal. Verify your ID to raise your limits.`
                      : `Up to ${formatMoney(limits.perTransaction)} per transfer or withdrawal.`}
            </span>
          </div>
        </div>
        {upgrade?.canApply && (
          <div className="flex shrink-0 justify-end pl-12 sm:pl-0">
            <Button asChild className="rounded-full">
              <Link to="/settings/upgrade">{rejection ? "Try again" : "Upgrade to Tier 2"}</Link>
            </Button>
          </div>
        )}
      </div>

      <Meter
        label="Sent and withdrawn today"
        used={limits.daily.used}
        limit={limits.daily.limit}
        caption={`${formatMoney(limits.daily.remaining)} left today. Resets at ${resetTime.format(new Date(limits.daily.resetsAt))}.`}
      />

      {limits.balance.max === null ? (
        <p className="flex items-center gap-2 bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <WalletIcon className="size-3.5 shrink-0" aria-hidden />
          No limit on how much your wallet can hold.
        </p>
      ) : (
        <Meter
          label="Wallet balance"
          used={limits.balance.current}
          limit={limits.balance.max}
          caption={`Your wallet can hold up to ${formatMoney(limits.balance.max)}. You can add ${formatMoney(limits.balance.room)} more. Money sent to you always arrives, even past this.`}
        />
      )}
    </>
  )
}
