import { useState, type ReactNode } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { BellIcon, CheckCircle2Icon, KeyRoundIcon, LifeBuoyIcon, LockKeyholeIcon, MailIcon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { toast } from "sonner"
import { savePreferences, useSupportEmail } from "@/api/account"
import { authKeys, type User } from "@/api/auth"
import { InsightsConsentDialog } from "@/components/insights/insights-consent"
import { LimitsRows } from "@/components/limits/limits-rows"
import { ChangePasswordForm } from "@/components/security/change-password-form"
import { ChangePinForm } from "@/components/security/change-pin-form"
import { SetPinForm } from "@/components/security/set-pin-form"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Switch } from "@/components/ui/switch"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { initials } from "@/lib/initials"
import { useInsightsToggle } from "@/lib/use-insights-toggle"
import { cn } from "@/lib/utils"

const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" })
const shortTime = new Intl.DateTimeFormat(undefined, { timeStyle: "short" })

const statusBadge = {
  good: "border-success/20 bg-success/10 text-success",
  warning: "border-amber-600/20 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  danger: "border-destructive/20 bg-destructive/10 text-destructive",
}

// A labelled group of rows in one card
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  const id = `settings-${title.toLowerCase()}`
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="px-1 text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {title}
      </h2>
      <div className="divide-y divide-border/70 overflow-hidden rounded-3xl bg-card shadow-soft ring-1 ring-border/70">
        {children}
      </div>
    </section>
  )
}

// Icon, title and description on the left; the control on the right. Buttons drop below the text on
// narrow screens; switches (inline) always stay beside it.
function SettingsRow({
  icon,
  title,
  description,
  status,
  action,
  htmlFor,
  inline = false,
}: {
  icon: ReactNode
  title: string
  description: ReactNode
  status?: ReactNode
  action: ReactNode
  htmlFor?: string
  inline?: boolean
}) {
  const Text = htmlFor ? "label" : "div"
  return (
    <div
      className={cn(
        "flex gap-3 p-4 sm:gap-4 sm:p-5",
        inline ? "flex-row items-center" : "flex-col sm:flex-row sm:items-center"
      )}
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          {icon}
        </span>
        <Text htmlFor={htmlFor} className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
            {title}
            {status}
          </span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{description}</span>
        </Text>
      </div>
      <div className={cn("flex shrink-0 justify-end", !inline && "pl-12 sm:pl-0")}>{action}</div>
    </div>
  )
}

function pinStatus(user: User) {
  if (user.pinLockedUntil) {
    return {
      badge: <Badge className={statusBadge.danger}>Locked</Badge>,
      description: `Too many wrong PINs. Transfers and withdrawals are locked until ${shortTime.format(new Date(user.pinLockedUntil))}.`,
    }
  }
  if (user.hasPin) {
    return {
      badge: (
        <Badge className={statusBadge.good}>
          <CheckCircle2Icon aria-hidden />
          Set
        </Badge>
      ),
      description: "Approves every transfer and withdrawal.",
    }
  }
  return {
    badge: <Badge className={statusBadge.warning}>Not set</Badge>,
    description: "Set one to send money and withdraw.",
  }
}

export function SettingsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [pinDialog, setPinDialog] = useState(false)
  const [passwordDialog, setPasswordDialog] = useState(false)
  const [insightsConsent, setInsightsConsent] = useState(false)
  const insightsToggle = useInsightsToggle()
  const supportEmail = useSupportEmail().data?.email

  const preferences = useMutation({
    mutationFn: savePreferences,
    onSuccess: ({ user: updated }) => {
      queryClient.setQueryData<User>(authKeys.me, updated)
      toast.success(updated.emailNotifications ? "Emails turned on" : "Emails turned off")
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  // PIN and password changes alter what the rows show (lock, "last changed"), so reload the profile
  const refreshProfile = () => void queryClient.invalidateQueries({ queryKey: authKeys.me })

  if (!user) return null
  const pin = pinStatus(user)

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 md:gap-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Manage your profile, security, limits and notifications.</p>
      </div>

      <SettingsSection title="Profile">
        <div className="flex items-center gap-4 p-4 sm:p-5">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {initials(user.name)}
          </span>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold">{user.name}</p>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Member since {longDate.format(new Date(user.createdAt))}
            </p>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Security">
        <SettingsRow
          icon={<LockKeyholeIcon className="size-4" aria-hidden />}
          title="Password"
          description={
            user.passwordChangedAt
              ? `Last changed ${longDate.format(new Date(user.passwordChangedAt))}`
              : "Never changed"
          }
          action={
            <Button variant="outline" className="rounded-full" onClick={() => setPasswordDialog(true)}>
              Change
            </Button>
          }
        />
        <SettingsRow
          icon={<KeyRoundIcon className="size-4" aria-hidden />}
          title="Transaction PIN"
          status={pin.badge}
          description={pin.description}
          action={
            <Button
              variant={user.hasPin ? "outline" : "default"}
              className="rounded-full"
              onClick={() => setPinDialog(true)}
            >
              {user.hasPin ? "Change" : "Set PIN"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="Limits">
        <LimitsRows />
      </SettingsSection>

      <SettingsSection title="AI features">
        <SettingsRow
          icon={<SparklesIcon className="size-4" aria-hidden />}
          title="Spending insights and assistant"
          description="Monthly insights and an assistant you can ask about your money, powered by Google's Gemini AI. Names and account details are never shared. Turning this off deletes your insights."
          htmlFor="ai-insights"
          inline
          action={
            <Switch
              id="ai-insights"
              checked={user.aiInsightsEnabled}
              disabled={insightsToggle.isPending}
              // Turning on goes through the consent dialog; turning off is immediate
              onCheckedChange={(checked) => (checked ? setInsightsConsent(true) : insightsToggle.mutate(false))}
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRow
          icon={<MailIcon className="size-4" aria-hidden />}
          title="Email me about money in and out"
          description="Deposits, transfers and withdrawals. You'll always see them in the app."
          htmlFor="email-money"
          inline
          action={
            <Switch
              id="email-money"
              checked={user.emailNotifications}
              disabled={preferences.isPending}
              onCheckedChange={(checked) => preferences.mutate({ emailNotifications: checked })}
            />
          }
        />
        <SettingsRow
          icon={<ShieldCheckIcon className="size-4" aria-hidden />}
          title="Security alerts by email"
          description="Sign-ins, password and PIN changes. Always on, for your safety."
          htmlFor="email-security"
          inline
          action={<Switch id="email-security" checked disabled aria-describedby="email-security-note" />}
        />
        <p
          id="email-security-note"
          className="flex items-center gap-2 bg-muted/40 px-4 py-3 text-xs text-muted-foreground sm:px-5"
        >
          <BellIcon className="size-3.5 shrink-0" aria-hidden />
          Notifications always appear under the bell, whatever you choose here.
        </p>
      </SettingsSection>

      <SettingsSection title="Help">
        <SettingsRow
          icon={<LifeBuoyIcon className="size-4" aria-hidden />}
          title="Help & support"
          description={supportEmail ? `Questions about your account or a payment? Email us at ${supportEmail}.` : "Questions about your account or a payment? Email our support team."}
          action={
            <Button asChild variant="outline" className="rounded-full" disabled={!supportEmail}>
              <a href={supportEmail ? `mailto:${supportEmail}?subject=${encodeURIComponent("PurpleWallet help")}` : undefined}>Email support</a>
            </Button>
          }
        />
      </SettingsSection>

      <InsightsConsentDialog open={insightsConsent} onOpenChange={setInsightsConsent} />

      <Dialog open={passwordDialog} onOpenChange={setPasswordDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Change your password</DialogTitle>
            <DialogDescription>You'll stay signed in here. Every other device will be signed out.</DialogDescription>
          </DialogHeader>
          {passwordDialog && (
            <ChangePasswordForm
              onDone={() => {
                setPasswordDialog(false)
                refreshProfile()
              }}
              onCancel={() => setPasswordDialog(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={pinDialog} onOpenChange={setPinDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{user.hasPin ? "Change your PIN" : "Set your transaction PIN"}</DialogTitle>
            <DialogDescription>
              {user.hasPin ? "Choose a new 4-digit PIN." : "You'll use it to approve every transfer and withdrawal."}
            </DialogDescription>
          </DialogHeader>
          {pinDialog &&
            (user.hasPin ? (
              <ChangePinForm
                onDone={() => {
                  setPinDialog(false)
                  refreshProfile()
                }}
                onCancel={() => setPinDialog(false)}
              />
            ) : (
              <SetPinForm onDone={() => setPinDialog(false)} onCancel={() => setPinDialog(false)} cancelLabel="Cancel" />
            ))}
        </DialogContent>
      </Dialog>
    </div>
  )
}
