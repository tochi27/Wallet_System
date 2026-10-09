import { ArrowDownLeftIcon, ArrowUpRightIcon, CalendarIcon, ChevronDownIcon, InboxIcon, SendIcon } from "lucide-react"
import { useSearchParams } from "react-router"
import { useWalletStats } from "@/api/wallet"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { BalanceCard } from "@/components/wallet/balance-card"
import { DeltaChip } from "@/components/wallet/delta-chip"
import { StatTile } from "@/components/wallet/stat-tile"
import { TransactionHistory } from "@/components/wallet/transaction-history"
import { percentChange } from "@/lib/stats"
import { cn } from "@/lib/utils"
import { useHiddenBalance } from "@/lib/use-hidden-balance"
import { BankAccountsCard } from "@/components/payments/bank-accounts-card"
import { WithdrawalsCard } from "@/components/payments/withdrawals-card"

const PERIODS = [7, 30, 90] as const
type Period = (typeof PERIODS)[number]

const rangeFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })
const asDate = (isoDate: string) => new Date(`${isoDate}T12:00:00`)

export function WalletPage() {
  // The period lives in the URL so it survives reloads and can be shared
  const [params, setParams] = useSearchParams()
  const requested = Number(params.get("period"))
  const days: Period = (PERIODS as readonly number[]).includes(requested) ? (requested as Period) : 30
  const { data: stats, isPlaceholderData } = useWalletStats(days)
  const { hidden } = useHiddenBalance()

  const comparison = <span className="text-xs text-muted-foreground">vs previous {days} days</span>
  const tile = (key: "moneyIn" | "moneyOut" | "sent" | "received") => ({
    value: stats?.current[key],
    delta: stats ? percentChange(stats.current[key], stats.previous[key]) : null,
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Wallet</h1>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="rounded-full bg-card shadow-soft">
              <CalendarIcon aria-hidden />
              {stats
                ? `${rangeFormatter.format(asDate(stats.current.from))} – ${rangeFormatter.format(asDate(stats.current.to))}`
                : `Last ${days} days`}
              <ChevronDownIcon aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs text-muted-foreground">Period</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={String(days)}
              onValueChange={(value) => setParams({ period: value }, { replace: true })}
            >
              {PERIODS.map((period) => (
                <DropdownMenuRadioItem key={period} value={String(period)}>
                  Last {period} days
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* While a new period loads, keep the old numbers on screen, dimmed */}
      <div className={cn("grid gap-4 transition-opacity md:gap-5 lg:grid-cols-12", isPlaceholderData && "opacity-60")}>
        <BalanceCard stats={stats} className="lg:col-span-5" />
        <div className="grid grid-cols-2 gap-3 md:gap-4 lg:col-span-7">
          <StatTile
            label="Money in"
            icon={ArrowDownLeftIcon}
            iconClassName="bg-success/12 text-success"
            value={tile("moneyIn").value}
            hidden={hidden}
            footer={stats && <><DeltaChip percent={tile("moneyIn").delta} upIsGood />{comparison}</>}
          />
          <StatTile
            label="Money out"
            icon={ArrowUpRightIcon}
            iconClassName="bg-destructive/10 text-destructive"
            value={tile("moneyOut").value}
            hidden={hidden}
            footer={stats && <><DeltaChip percent={tile("moneyOut").delta} upIsGood={false} />{comparison}</>}
          />
          <StatTile
            label="Sent"
            icon={SendIcon}
            iconClassName="bg-secondary text-primary"
            value={tile("sent").value}
            hidden={hidden}
            footer={stats && <><DeltaChip percent={tile("sent").delta} upIsGood={null} />{comparison}</>}
          />
          <StatTile
            label="Received"
            icon={InboxIcon}
            iconClassName="bg-secondary text-primary"
            value={tile("received").value}
            hidden={hidden}
            footer={stats && <><DeltaChip percent={tile("received").delta} upIsGood />{comparison}</>}
          />
        </div>
      </div>

      <div className="grid items-start gap-4 md:gap-5 lg:grid-cols-2">
        <BankAccountsCard />
        <WithdrawalsCard />
      </div>

      <section aria-labelledby="history-heading">
        <h2 id="history-heading" className="mb-3 text-lg font-semibold">
          Transactions
        </h2>
        <TransactionHistory />
      </section>
    </div>
  )
}
