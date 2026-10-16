import { useEffect } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ArrowUpRightIcon, Loader2Icon, MailIcon, HomeIcon, MessageCircleIcon, PlusIcon, SendIcon, SettingsIcon, ShieldCheckIcon, SparklesIcon, WalletIcon, type LucideIcon } from "lucide-react"
import { NavLink, Outlet } from "react-router"
import { toast } from "sonner"
import { authKeys, resendVerification } from "@/api/auth"
import { AssistantProvider } from "@/components/assistant/assistant-panel"
import { Brand } from "@/components/layout/brand"
import { UserMenu } from "@/components/layout/user-menu"
import { NotificationBell } from "@/components/notifications/notification-bell"
import { Button } from "@/components/ui/button"
import { MoneyActionsProvider } from "@/components/wallet/money-actions-provider"
import { errorMessage } from "@/lib/api"
import { useOpenAssistant } from "@/lib/assistant-context"
import { useAuth } from "@/lib/auth-context"
import { isStaff } from "@/lib/permissions"
import { useMoneyActions } from "@/lib/money-actions-context"
import { cn } from "@/lib/utils"

type NavItem = { to: string; label: string; icon: LucideIcon; end: boolean }

const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: HomeIcon, end: true },
  { to: "/wallet", label: "Wallet", icon: WalletIcon, end: false },
  { to: "/insights", label: "Insights", icon: SparklesIcon, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
]

const ADMIN_ITEM: NavItem = { to: "/admin", label: "Admin", icon: ShieldCheckIcon, end: false }

/**
 * Phones (< md): top bar + bottom tab bar with a raised Send button, as in the design.
 * Tablets (md): slim icon sidebar. Desktop (lg+): full sidebar with labels and quick actions.
 */
export function AppShell() {
  return (
    <MoneyActionsProvider>
      <AssistantProvider>
      <div className="page-glow min-h-svh md:flex">
        <Sidebar />
        <div className="min-w-0 flex-1">
          <header className="flex h-16 items-center justify-between px-4 md:hidden print:hidden">
            <Brand />
            <div className="flex items-center gap-1">
              <AskButton />
              <NotificationBell />
              <UserMenu />
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1400px] px-4 pt-2 pb-32 md:px-8 md:pt-8 md:pb-12 lg:px-10">
            <VerifyEmailBanner />
            <FrozenBanner />
            <Outlet />
          </main>
        </div>
        <BottomTabBar />
      </div>
      </AssistantProvider>
    </MoneyActionsProvider>
  )
}

// Shown to a user whose account an admin has put on hold. The reason stays internal.
function FrozenBanner() {
  const { user } = useAuth()
  if (!user?.frozen) return null
  return (
    <div role="status" className="mb-5 flex gap-3 rounded-2xl border border-destructive/20 bg-destructive/5 p-4 text-sm print:hidden">
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
      <p>
        <span className="font-medium">Your account is on hold.</span>{" "}
        <span className="text-muted-foreground">
          You can sign in, see your wallet and receive money, but you can't send or withdraw money for now. Please contact support.
        </span>
      </p>
    </div>
  )
}

// Shown until the user follows the link in their verification email. Money can't move until then.
function VerifyEmailBanner() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const unverified = user !== null && user !== undefined && !user.emailVerified

  // They'll usually verify in another tab or on their phone: check again when they come back
  useEffect(() => {
    if (!unverified) return
    const recheck = () => {
      if (document.visibilityState === "visible") void queryClient.invalidateQueries({ queryKey: authKeys.me })
    }
    document.addEventListener("visibilitychange", recheck)
    return () => document.removeEventListener("visibilitychange", recheck)
  }, [unverified, queryClient])

  const resend = useMutation({
    mutationFn: resendVerification,
    onSuccess: () => toast.success(`We've sent a new link to ${user?.email}`),
    onError: (error) => toast.error(errorMessage(error)),
  })

  if (!unverified) return null
  return (
    <div role="status" className="mb-5 flex flex-col gap-3 rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm sm:flex-row sm:items-center print:hidden">
      <div className="flex flex-1 gap-3">
        <MailIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
        <p>
          <span className="font-medium">Verify your email to start moving money.</span>{" "}
          <span className="text-muted-foreground">
            We sent a link to <span className="font-medium text-foreground">{user.email}</span>. Until then you can look around, but you can't add, send or withdraw money.
          </span>
        </p>
      </div>
      <Button size="sm" variant="outline" className="shrink-0 self-start sm:self-auto" onClick={() => resend.mutate()} disabled={resend.isPending}>
        {resend.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
        Resend link
      </Button>
    </div>
  )
}

function Sidebar() {
  const openAction = useMoneyActions()
  const { user } = useAuth()
  const navItems = isStaff(user?.role) ? [...NAV_ITEMS, ADMIN_ITEM] : NAV_ITEMS

  // The outer column carries the background full-height; the inner panel stays pinned while the page scrolls
  return (
    <div className="hidden shrink-0 border-r border-border/70 bg-card/80 backdrop-blur md:block md:w-20 lg:w-64 print:hidden">
      <aside className="sticky top-0 flex h-svh flex-col">
        <div className="flex h-20 items-center justify-center px-5 lg:justify-start">
          <Brand compact />
        </div>

        <nav className="flex flex-col gap-1 px-3" aria-label="Main">
          {navItems.map((item) => (
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
          <AskButton variant="sidebar" />
          <QuickAction icon={PlusIcon} label="Add money" onClick={() => openAction("credit")} className="bg-primary text-primary-foreground hover:bg-primary/90" />
          <QuickAction icon={SendIcon} label="Send money" onClick={() => openAction("transfer")} className="bg-foreground text-background hover:bg-foreground/90" />
          <QuickAction icon={ArrowUpRightIcon} label="Withdraw" onClick={() => openAction("debit")} variant="outline" />
        </div>

        <div className="mt-auto flex flex-col gap-1 border-t border-border/70 p-3">
          <NotificationBell variant="sidebar" />
          <UserMenu variant="sidebar" />
        </div>
      </aside>
    </div>
  )
}

// Opens the assistant. Phones: an icon in the top bar. Sidebar: a full-width button.
function AskButton({ variant = "header" }: { variant?: "header" | "sidebar" }) {
  const openAssistant = useOpenAssistant()
  if (variant === "header") {
    return (
      <Button variant="ghost" size="icon" className="size-9 rounded-full" onClick={openAssistant} aria-label="Ask PurpleWallet">
        <MessageCircleIcon aria-hidden />
      </Button>
    )
  }
  return (
    <QuickAction
      icon={MessageCircleIcon}
      label="Ask PurpleWallet"
      onClick={openAssistant}
      className="bg-primary/10 text-primary hover:bg-primary/15"
    />
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
      className="fixed inset-x-0 bottom-0 z-20 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden print:hidden"
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
