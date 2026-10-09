import { ArrowUpRightIcon, EyeIcon, EyeOffIcon, PlusIcon, SendIcon, WalletIcon } from "lucide-react"
import { useBalance, type WalletStats } from "@/api/wallet"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { DeltaChip } from "@/components/wallet/delta-chip"
import { errorMessage } from "@/lib/api"
import { formatSignedMoney, toAmount } from "@/lib/money"
import { useMoneyActions } from "@/lib/money-actions-context"
import { cn } from "@/lib/utils"
import { useHiddenBalance } from "@/lib/use-hidden-balance"

type BalanceCardProps = {
  // Stats for the selected period, used for the "balance change" line
  stats?: WalletStats
  className?: string
}

export function BalanceCard({ stats, className }: BalanceCardProps) {
  const { data, isPending, isError, error, refetch } = useBalance()
  const openAction = useMoneyActions()
  const { hidden, toggle } = useHiddenBalance()

  return (
    <section
      className={cn("rounded-3xl bg-card p-5 shadow-soft ring-1 ring-border/70 sm:p-6", className)}
      aria-labelledby="balance-heading"
    >
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-secondary text-primary" aria-hidden>
          <WalletIcon className="size-4.5" />
        </span>
        <h2 id="balance-heading" className="font-semibold">
          Balance
        </h2>
        <div className="ml-auto flex items-center gap-1 rounded-full bg-muted p-0.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label="More actions">
                <PlusIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openAction("credit")}>
                <PlusIcon aria-hidden />
                Add money
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction("debit")}>
                <ArrowUpRightIcon aria-hidden />
                Withdraw
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => openAction("transfer")}>
                <SendIcon aria-hidden />
                Send money
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            className="rounded-full"
            onClick={toggle}
            aria-pressed={hidden}
            aria-label={hidden ? "Show balance" : "Hide balance"}
          >
            {hidden ? <EyeOffIcon /> : <EyeIcon />}
          </Button>
        </div>
      </div>

      <div className="mt-6 flex flex-col items-center gap-3 text-center">
        {isPending ? (
          <Skeleton className="h-12 w-52" />
        ) : isError ? (
          <div className="flex flex-col items-center gap-2 text-sm">
            <p className="text-destructive">{errorMessage(error)}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : (
          <p className="text-4xl font-semibold tracking-tight sm:text-5xl">
            <Money value={data.balance} hidden={hidden} />
          </p>
        )}

        {stats && <BalanceChange stats={stats} hidden={hidden} />}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <Button size="lg" className="h-11 rounded-full" onClick={() => openAction("credit")}>
          <PlusIcon aria-hidden />
          Add money
        </Button>
        <Button
          size="lg"
          className="h-11 rounded-full bg-foreground text-background hover:bg-foreground/90"
          onClick={() => openAction("transfer")}
        >
          <SendIcon aria-hidden />
          Send money
        </Button>
      </div>
    </section>
  )
}

const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })

function BalanceChange({ stats, hidden }: { stats: WalletStats; hidden: boolean }) {
  const change = toAmount(stats.balance.change)
  const since = `since ${shortDate.format(new Date(`${stats.current.from}T12:00:00`))}`

  if (change === 0) {
    return <p className="text-sm text-muted-foreground">No change {since}</p>
  }

  return (
    <p className="flex items-center gap-2 text-sm">
      {stats.balance.changePercent !== null ? (
        <DeltaChip percent={stats.balance.changePercent} upIsGood className="text-sm" />
      ) : (
        <span className={cn("font-medium", change > 0 ? "text-success" : "text-destructive")}>
          {hidden ? "••••" : formatSignedMoney(change)}
        </span>
      )}
      <span className="text-muted-foreground">{since}</span>
    </p>
  )
}
