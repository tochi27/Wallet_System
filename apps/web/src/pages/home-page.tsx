import { useState } from "react"
import { ArrowDownLeftIcon, ArrowUpRightIcon, ScaleIcon, WalletIcon } from "lucide-react"
import { useBalance, useWalletStats } from "@/api/wallet"
import { DeltaChip } from "@/components/wallet/delta-chip"
import { GrowthHero } from "@/components/wallet/growth-hero"
import { RecentTransactions } from "@/components/wallet/recent-transactions"
import { StatTile } from "@/components/wallet/stat-tile"
import { WeeklyChart } from "@/components/wallet/weekly-chart"
import { useAuth } from "@/lib/auth-context"
import { greeting, percentChange } from "@/lib/stats"
import { useHiddenBalance } from "@/lib/use-hidden-balance"

const todayFormatter = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" })

export function HomePage() {
  const { user } = useAuth()
  const { data: balance } = useBalance()
  const { data: week } = useWalletStats(7)
  const { data: month } = useWalletStats(30)
  const { hidden } = useHiddenBalance()
  // Read the clock once per visit so re-renders don't change the greeting mid-view
  const [now] = useState(() => new Date())
  const firstName = user?.name.split(/\s+/)[0]

  const vsPrevious = <span className="text-xs text-muted-foreground">vs previous 30 days</span>

  return (
    <div className="flex flex-col gap-5 md:gap-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="text-muted-foreground">{greeting(now)},</p>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{firstName}</h1>
        </div>
        <p className="hidden text-sm text-muted-foreground md:block">{todayFormatter.format(now)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:gap-4 xl:grid-cols-4">
        <StatTile
          label="Balance"
          icon={WalletIcon}
          iconClassName="bg-secondary text-primary"
          value={balance?.balance ?? undefined}
          hidden={hidden}
        />
        <StatTile
          label="Money in · 30 days"
          icon={ArrowDownLeftIcon}
          iconClassName="bg-success/12 text-success"
          value={month?.current.moneyIn}
          hidden={hidden}
          footer={month && <><DeltaChip percent={percentChange(month.current.moneyIn, month.previous.moneyIn)} upIsGood />{vsPrevious}</>}
        />
        <StatTile
          label="Money out · 30 days"
          icon={ArrowUpRightIcon}
          iconClassName="bg-destructive/10 text-destructive"
          value={month?.current.moneyOut}
          hidden={hidden}
          footer={month && <><DeltaChip percent={percentChange(month.current.moneyOut, month.previous.moneyOut)} upIsGood={false} />{vsPrevious}</>}
        />
        <StatTile
          label="Net · 30 days"
          icon={ScaleIcon}
          iconClassName="bg-secondary text-primary"
          value={month?.current.net}
          hidden={hidden}
          footer={<span className="text-xs text-muted-foreground">Money in minus money out</span>}
        />
      </div>

      <div className="grid items-stretch gap-5 md:gap-6 xl:grid-cols-5">
        <GrowthHero stats={week} className="xl:col-span-2" />
        <WeeklyChart stats={week} className="xl:col-span-3" />
      </div>

      <RecentTransactions />
    </div>
  )
}
