import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertTriangleIcon, ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, KeyRoundIcon, LockIcon, ScaleIcon, UnlockIcon } from "lucide-react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { TIER_NAMES } from "@/api/account"
import { adminKeys, runUserAction, useAdminUser, type AdminUserDetail, type UserAction } from "@/api/admin"
import { EmptyState, PaymentBadge, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { actionLabel, formatDateTime, tone, actorName } from "@/lib/admin"
import { AdjustDialog } from "@/components/admin/adjust-dialog"
import { ReasonDialog } from "@/components/admin/reason-dialog"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { StatusBadge } from "@/components/wallet/status-badge"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { initials } from "@/lib/initials"
import { can, ROLE_INFO } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const ACTIONS: Record<UserAction, { title: string; description: string; confirm: string; done: string; destructive?: boolean }> = {
  freeze: {
    title: "Freeze this account?",
    description: "They'll still be able to sign in, see their wallet and receive money, but not send, withdraw or add bank accounts. They're told their account is on hold.",
    confirm: "Freeze account",
    done: "Account frozen",
    destructive: true,
  },
  unfreeze: {
    title: "Unfreeze this account?",
    description: "They'll be able to send and withdraw money again, and are told the hold is lifted.",
    confirm: "Unfreeze account",
    done: "Account unfrozen",
  },
  "unlock-pin": {
    title: "Unlock their transaction PIN?",
    description: "Only do this once you're sure it's really them asking. They're notified when it's unlocked.",
    confirm: "Unlock PIN",
    done: "PIN unlocked",
  },
  "tier-2": {
    title: "Raise this account to Tier 2?",
    description: "Only once you've checked who they are. They'll be able to send and withdraw up to ₦500,000 at a time and ₦2,000,000 a day, with no limit on their balance. They're told their new limits.",
    confirm: "Raise to Tier 2",
    done: "Moved to Tier 2",
  },
  "tier-1": {
    title: "Move this account back to Tier 1?",
    description: "They'll be limited to ₦50,000 per payment, ₦200,000 a day and a ₦500,000 balance. Money already in the wallet stays, but they can't add more while over the cap. They're told their new limits.",
    confirm: "Move to Tier 1",
    done: "Moved to Tier 1",
    destructive: true,
  },
}

export function AdminUserPage() {
  const { id = "" } = useParams()
  const { data: user, error } = useAdminUser(id)

  return (
    <div className="flex flex-col gap-5">
      <Link to="/admin/users" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden />
        All users
      </Link>
      {error ? (
        <Panel>
          <EmptyState>{errorMessage(error)}</EmptyState>
        </Panel>
      ) : !user ? (
        <Skeleton className="h-40 w-full rounded-3xl" />
      ) : (
        <UserDetail user={user} />
      )}
    </div>
  )
}

function UserDetail({ user }: { user: AdminUserDetail }) {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [action, setAction] = useState<UserAction | null>(null)

  const mutation = useMutation({
    mutationFn: ({ kind, reason }: { kind: UserAction; reason: string }) => runUserAction(user.id, kind, reason),
    onSuccess: (updated, { kind }) => {
      queryClient.setQueryData(adminKeys.user(user.id), updated)
      void queryClient.invalidateQueries({ queryKey: adminKeys.all, predicate: (q) => q.queryKey[1] !== "user" })
      toast.success(ACTIONS[kind].done)
      setAction(null)
    },
  })

  const [adjusting, setAdjusting] = useState(false)
  // Buttons follow the signed-in admin's role; the API enforces the same rules
  const manage = can(me?.role, "users.manage")
  const canFreeze = manage && user.role === "USER" && user.id !== me?.id
  const canAdjust = can(me?.role, "adjustments.manage") && user.id !== me?.id
  const open = (kind: UserAction) => {
    mutation.reset()
    setAction(kind)
  }

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-5 p-5 md:flex-row md:items-center">
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
            {initials(user.name)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-lg font-semibold">{user.name}</h2>
              {user.frozenAt ? <ToneBadge className={tone.bad}>Frozen</ToneBadge> : <ToneBadge className={tone.good}>Active</ToneBadge>}
              {user.role !== "USER" && <ToneBadge className={tone.quiet}>{ROLE_INFO[user.role].label}</ToneBadge>}
              <ToneBadge className={tone.quiet}>{TIER_NAMES[user.tier]}</ToneBadge>
              {!user.emailVerifiedAt && <ToneBadge className={tone.waiting}>Email not verified</ToneBadge>}
            </div>
            <p className="truncate text-sm text-muted-foreground">{user.email}</p>
            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{user.id}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {canAdjust && (
              <Button variant="outline" className="rounded-full" onClick={() => setAdjusting(true)}>
                <ScaleIcon aria-hidden />
                Adjust balance
              </Button>
            )}
            {manage && user.pinLockedUntil && (
              <Button variant="outline" className="rounded-full" onClick={() => open("unlock-pin")}>
                <KeyRoundIcon aria-hidden />
                Unlock PIN
              </Button>
            )}
            {manage && user.id !== me?.id && (
              <Button variant="outline" className="rounded-full" onClick={() => open(user.tier === "TIER_1" ? "tier-2" : "tier-1")}>
                {user.tier === "TIER_1" ? <ArrowUpIcon aria-hidden /> : <ArrowDownIcon aria-hidden />}
                {user.tier === "TIER_1" ? "Raise to Tier 2" : "Move to Tier 1"}
              </Button>
            )}
            {canFreeze &&
              (user.frozenAt ? (
                <Button className="rounded-full" onClick={() => open("unfreeze")}>
                  <UnlockIcon aria-hidden />
                  Unfreeze
                </Button>
              ) : (
                <Button variant="destructive" className="rounded-full" onClick={() => open("freeze")}>
                  <LockIcon aria-hidden />
                  Freeze
                </Button>
              ))}
          </div>
        </div>
        {user.frozenAt && (
          <div className="flex gap-3 border-t border-border/70 bg-destructive/5 px-5 py-4 text-sm">
            <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <p>
              <span className="font-medium">Frozen since {formatDateTime(user.frozenAt)}.</span>{" "}
              <span className="text-muted-foreground">Reason: {user.frozenReason}</span>
            </p>
          </div>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Account">
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 p-5 text-sm">
            <dt className="text-muted-foreground">Balance</dt>
            <dd className="font-semibold">
              <Money value={user.balance.stored} />
            </dd>
            <dt className="text-muted-foreground">Ledger check</dt>
            <dd>
              {user.balance.matches ? (
                <ToneBadge className={tone.good}>Balance, transactions and ledger agree</ToneBadge>
              ) : (
                <span className="flex flex-col gap-1">
                  <ToneBadge className={cn(tone.bad, "self-start")}>Mismatch</ToneBadge>
                  <span className="text-xs text-muted-foreground">
                    Opening balance plus transactions since the ledger started: <Money value={user.balance.computed} />; the ledger says <Money value={user.balance.ledger} />
                  </span>
                </span>
              )}
            </dd>
            <dt className="text-muted-foreground">Transaction PIN</dt>
            <dd>
              {user.pinLockedUntil ? (
                <ToneBadge className={tone.bad}>Locked until {formatDateTime(user.pinLockedUntil)}</ToneBadge>
              ) : user.hasPin ? (
                <span>Set{user.pinFailedAttempts > 0 && ` · ${user.pinFailedAttempts} recent wrong attempt${user.pinFailedAttempts === 1 ? "" : "s"}`}</span>
              ) : (
                <span className="text-muted-foreground">Not set</span>
              )}
            </dd>
            <dt className="text-muted-foreground">Password changed</dt>
            <dd>{user.passwordChangedAt ? formatDateTime(user.passwordChangedAt) : "Never"}</dd>
            <dt className="text-muted-foreground">Money emails</dt>
            <dd>{user.emailNotifications ? "On" : "Off"}</dd>
            <dt className="text-muted-foreground">Joined</dt>
            <dd>{formatDateTime(user.createdAt)}</dd>
          </dl>
        </Panel>

        <Panel title="Devices and bank accounts">
          <div className="divide-y divide-border/70 text-sm">
            {user.devices.length === 0 && user.bankAccounts.length === 0 && <EmptyState>No devices or bank accounts yet.</EmptyState>}
            {user.devices.map((device) => (
              <div key={device.label + device.createdAt} className="flex justify-between gap-4 px-5 py-3">
                <span>{device.label}</span>
                <span className="text-muted-foreground">Last seen {formatDateTime(device.lastSeenAt)}</span>
              </div>
            ))}
            {user.bankAccounts.map((account) => (
              <div key={account.id} className="flex justify-between gap-4 px-5 py-3">
                <span>
                  {account.bankName} ····{account.accountNumberLast4}
                </span>
                <span className="truncate text-muted-foreground">{account.accountName}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <Panel title="Recent transactions">
        {user.transactions.length === 0 ? (
          <EmptyState>No transactions yet.</EmptyState>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Description</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="hidden pr-5 md:table-cell">Date</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {user.transactions.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="pl-5">{tx.description ?? (tx.type === "CREDIT" ? "Credit" : "Debit")}</TableCell>
                  <TableCell>
                    <StatusBadge status={tx.status} />
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {tx.type === "CREDIT" ? "+" : "−"}
                    <Money value={tx.amount} />
                  </TableCell>
                  <TableCell className="hidden pr-5 text-muted-foreground md:table-cell">{formatDateTime(tx.timestamp)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Deposits">
          {user.deposits.length === 0 ? (
            <EmptyState>No deposits.</EmptyState>
          ) : (
            <ul className="divide-y divide-border/70 text-sm">
              {user.deposits.map((d) => (
                <li key={d.reference} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      <Money value={d.amount} />
                    </span>
                    <span className="block truncate font-mono text-xs text-muted-foreground">{d.reference}</span>
                  </span>
                  <PaymentBadge status={d.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Withdrawals">
          {user.withdrawals.length === 0 ? (
            <EmptyState>No withdrawals.</EmptyState>
          ) : (
            <ul className="divide-y divide-border/70 text-sm">
              {user.withdrawals.map((w) => (
                <li key={w.reference} className="flex items-center justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      <Money value={w.amount} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {w.bankAccount.bankName} ····{w.bankAccount.accountNumberLast4}
                    </span>
                  </span>
                  <PaymentBadge status={w.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {user.adjustments.length > 0 && (
        <Panel title="Balance adjustments">
          <ul className="divide-y divide-border/70 text-sm">
            {user.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                <span className="min-w-0">
                  <span className="block font-medium">
                    {a.direction === "CREDIT" ? "+" : "−"}
                    <Money value={a.amount} /> · {a.kind.charAt(0) + a.kind.slice(1).toLowerCase()}
                  </span>
                  <span className="block text-muted-foreground">{a.reason}</span>
                  <span className="block text-xs text-muted-foreground">
                    Requested by {a.requestedBy.name} · {formatDateTime(a.createdAt)}
                    {a.decidedBy ? ` · ${a.status === "REJECTED" ? "rejected" : "approved"} by ${a.decidedBy.name}` : ""}
                  </span>
                </span>
                <ToneBadge className={a.status === "APPROVED" ? tone.good : a.status === "PENDING" ? tone.waiting : tone.bad}>
                  {a.status.charAt(0) + a.status.slice(1).toLowerCase()}
                </ToneBadge>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel title="Admin history">
        {user.auditLog.length === 0 ? (
          <EmptyState>No admin actions on this account.</EmptyState>
        ) : (
          <ul className="divide-y divide-border/70 text-sm">
            {user.auditLog.map((entry) => (
              <li key={entry.id} className="px-5 py-3">
                <p>
                  <span className="font-medium">{actionLabel(entry.action)}</span>{" "}
                  <span className="text-muted-foreground">
                    by {actorName(entry.admin)} · {formatDateTime(entry.createdAt)}
                  </span>
                </p>
                <p className="mt-0.5 text-muted-foreground">{entry.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <AdjustDialog userId={user.id} userName={user.name} balance={user.balance.stored} open={adjusting} onOpenChange={setAdjusting} />

      {action && (
        <ReasonDialog
          open
          onOpenChange={(next) => !next && setAction(null)}
          title={ACTIONS[action].title}
          description={ACTIONS[action].description}
          confirmLabel={ACTIONS[action].confirm}
          destructive={ACTIONS[action].destructive}
          pending={mutation.isPending}
          error={mutation.isError ? errorMessage(mutation.error) : null}
          onConfirm={(reason) => mutation.mutate({ kind: action, reason })}
        />
      )}
    </>
  )
}
