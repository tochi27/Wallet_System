import { ArrowUpRightIcon, HomeIcon, PlusIcon, SendIcon, WalletIcon, type LucideIcon } from "lucide-react"
import { NavLink, Outlet } from "react-router"
import { Brand } from "@/components/layout/brand"
import { UserMenu } from "@/components/layout/user-menu"
import { Button } from "@/components/ui/button"
import { MoneyActionsProvider } from "@/components/wallet/money-actions-provider"
import { useMoneyActions } from "@/lib/money-actions-context"
import { cn } from "@/lib/utils"

type NavItem = { to: string; label: string; icon: LucideIcon; end: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/wallet", label: "Wallet", icon: WalletIcon, end: false },
]

/**
 * Phones (< md): top bar + bottom tab bar with a raised Send button, as in the design.
 * Tablets (md): slim icon sidebar. Desktop (lg+): full sidebar with labels and quick actions.
 */
export function AppShell() {
  return (
    <MoneyActionsProvider>
      <div className="page-glow min-h-svh md:flex">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <header className="flex h-16 items-center justify-between px-4 md:hidden">
            <Brand />
            <UserMenu />
          </header>
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-32 md:px-8 md:pt-8 md:pb-12 lg:px-10">
            <Outlet />
          </main>
        </div>
        <BottomTabBar />
      </div>
    </MoneyActionsProvider>
  )
}

function Sidebar() {
  const openAction = useMoneyActions()

  // The outer column carries the background full-height; the inner panel stays pinned while the page scrolls
  return (
    <div className="hidden shrink-0 border-r border-border/70 bg-card/80 backdrop-blur md:block md:w-20 lg:w-64">
      <aside className="sticky top-0 flex h-svh flex-col">
        <div className="flex h-20 items-center justify-center px-5 lg:justify-start">
          <Brand compact />
        </div>

        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              title={item.label}
              className={({ isActive }) =>
                cn(
                  "flex h-11 items-center justify-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors lg:justify-start",
                  isActive
                    ? "bg-secondary text-secondary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )
              }
            >
              <item.icon className="size-5 shrink-0" aria-hidden />
              <span className="sr-only lg:not-sr-only">{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-8 flex flex-col gap-2 px-3">
          <p className="hidden px-3 text-xs font-medium text-muted-foreground lg:block">Quick actions</p>
          <QuickAction icon={PlusIcon} label="Add money" onClick={() => openAction("credit")} className="bg-primary text-primary-foreground hover:bg-primary/90" />
          <QuickAction icon={SendIcon} label="Send money" onClick={() => openAction("transfer")} className="bg-foreground text-background hover:bg-foreground/90" />
          <QuickAction icon={ArrowUpRightIcon} label="Withdraw" onClick={() => openAction("debit")} variant="outline" />
        </div>

        <div className="mt-auto border-t border-border/70 p-3">
          <UserMenu variant="sidebar" />
        </div>
      </aside>
    </div>
  )
}

type QuickActionProps = {
  icon: LucideIcon
  label: string
  onClick: () => void
  className?: string
  variant?: "default" | "outline"
}

function QuickAction({ icon: Icon, label, onClick, className, variant = "default" }: QuickActionProps) {
  return (
    <Button
      variant={variant}
      onClick={onClick}
      title={label}
      className={cn("h-11 justify-center rounded-xl lg:justify-start lg:px-4", className)}
    >
      <Icon aria-hidden />
      <span className="sr-only lg:not-sr-only">{label}</span>
    </Button>
  )
}

// Phone navigation: tabs either side of a raised "Send" button
function BottomTabBar() {
  const openAction = useMoneyActions()
  const [home, wallet] = NAV_ITEMS

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      aria-label="Main"
    >
      <div className="mx-auto grid h-16 max-w-md grid-cols-3 items-center">
        <TabLink {...home} />
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => openAction("transfer")}
            className="-mt-8 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg ring-4 ring-background transition-transform outline-none focus-visible:ring-ring active:scale-95"
            aria-label="Send money"
          >
            <SendIcon className="size-5" aria-hidden />
          </button>
        </div>
        <TabLink {...wallet} />
      </div>
    </nav>
  )
}

function TabLink({ to, label, icon: Icon, end }: NavItem) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        cn(
          "flex flex-col items-center gap-1 text-[11px] font-medium transition-colors",
          isActive ? "text-primary" : "text-muted-foreground"
        )
      }
    >
      <Icon className="size-5" aria-hidden />
      {label}
    </NavLink>
  )
}
