import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, AlertTriangleIcon, InfoIcon, Loader2Icon } from "lucide-react"
import { Link } from "react-router"
import { toast } from "sonner"
import { adminKeys, approveAdjustment, rejectAdjustment, useAdjustments, type Adjustment } from "@/api/admin"
import { EmptyState, LoadMore, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { Money } from "@/components/money"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, tone } from "@/lib/admin"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { formatMoney } from "@/lib/money"
import { can } from "@/lib/permissions"

const kindLabel = (a: Adjustment) => `${a.direction === "CREDIT" ? "Add" : "Take"} · ${a.kind.charAt(0) + a.kind.slice(1).toLowerCase()}`
const statusTone = { APPROVED: tone.good, PENDING: tone.waiting, REJECTED: tone.bad }

export function AdminAdjustmentsPage() {
  const { user: me } = useAuth()
  const pending = useAdjustments("PENDING")
  const all = useAdjustments()
  const [deciding, setDeciding] = useState<{ adjustment: Adjustment; decision: "approve" | "reject"; selfApprove: boolean } | null>(null)
  const canDecide = can(me?.role, "adjustments.manage")
  const pendingItems = pending.data?.pages.flatMap((p) => p.items) ?? []
  const history = all.data?.pages.flatMap((p) => p.items) ?? []
  // No other Finance or Owner admin exists, so this admin may approve their own requests
  const soloMode = (pending.data?.pages[0] as { soloMode?: boolean } | undefined)?.soloMode ?? false

  return (
    <div className="flex flex-col gap-5">
      {soloMode && canDecide && (
        <div className="flex gap-3 rounded-2xl border border-amber-600/20 bg-amber-500/5 p-4 text-sm">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
          <p>
            <span className="font-medium">You're the only admin who can approve adjustments,</span>{" "}
            <span className="text-muted-foreground">
              so you can approve your own requests above ₦10,000. Each one is marked self-approved in the audit log. Add a
              second Finance or Owner admin in{" "}
              <Link to="/admin/staff" className="underline">
                Staff
              </Link>{" "}
              to switch the two-person rule back on.
            </span>
          </p>
        </div>
      )}

      <Panel title="Waiting for approval">
        {pending.isPending ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : pendingItems.length === 0 ? (
          <EmptyState>Nothing is waiting for approval.</EmptyState>
        ) : (
          <ul className="divide-y divide-border/70">
            {pendingItems.map((a) => {
              const own = a.requestedBy.id === me?.id
              return (
                <li key={a.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-semibold">
                      {a.direction === "CREDIT" ? "+" : "−"}
                      <Money value={a.amount} />{" "}
                      <span className="font-normal text-muted-foreground">
                        {a.direction === "CREDIT" ? "to" : "from"}{" "}
                        <Link to={`/admin/users/${a.user.id}`} className="text-foreground hover:underline">
                          {a.user.name}
                        </Link>
                      </span>
                    </p>
                    <p className="text-muted-foreground">
                      {kindLabel(a)} · {a.reason}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Requested by {own ? "you" : a.requestedBy.name} · {formatDateTime(a.createdAt)}
                    </p>
                  </div>
                  {canDecide && (
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" className="rounded-full" onClick={() => setDeciding({ adjustment: a, decision: "reject", selfApprove: false })}>
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        className="rounded-full"
                        disabled={own && !soloMode}
                        title={own && !soloMode ? "A different admin must approve your own request" : undefined}
                        onClick={() => setDeciding({ adjustment: a, decision: "approve", selfApprove: own })}
                      >
                        Approve
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel title="All adjustments">
        {all.isPending ? (
          <div className="p-5">
            <Skeleton className="h-6 w-full" />
          </div>
        ) : history.length === 0 ? (
          <EmptyState>No balance adjustments yet. Make one from a user's page.</EmptyState>
        ) : (
          <>
            <ul className="divide-y divide-border/70 text-sm">
              {history.map((a) => (
                <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
                  <span className="min-w-0">
                    <span className="block font-medium">
                      {a.direction === "CREDIT" ? "+" : "−"}
                      <Money value={a.amount} /> · {a.user.name}
                    </span>
                    <span className="block text-muted-foreground">
                      {kindLabel(a)} · {a.reason}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {a.requestedBy.name}, {formatDateTime(a.createdAt)}
                      {a.decidedBy && a.decidedBy.id !== a.requestedBy.id ? ` · ${a.status === "REJECTED" ? "rejected" : "approved"} by ${a.decidedBy.name}` : ""}
                      {a.status === "APPROVED" && a.needsSecondAdmin && a.decidedBy?.id === a.requestedBy.id ? " · self-approved (no second approver)" : ""}
                      {a.decisionNote && a.status === "REJECTED" ? ` · ${a.decisionNote}` : ""}
                    </span>
                  </span>
                  <ToneBadge className={statusTone[a.status]}>{a.status.charAt(0) + a.status.slice(1).toLowerCase()}</ToneBadge>
                </li>
              ))}
            </ul>
            <LoadMore hasMore={all.hasNextPage} loading={all.isFetchingNextPage} onClick={() => void all.fetchNextPage()} />
          </>
        )}
      </Panel>

      {deciding && <DecisionDialog {...deciding} onClose={() => setDeciding(null)} />}
    </div>
  )
}

function DecisionDialog({ adjustment, decision, selfApprove, onClose }: { adjustment: Adjustment; decision: "approve" | "reject"; selfApprove: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState("")
  const [text, setText] = useState("")
  const approve = decision === "approve"

  const mutation = useMutation({
    mutationFn: () => (approve ? approveAdjustment(adjustment.id, password, text.trim() || undefined) : rejectAdjustment(adjustment.id, password, text.trim())),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all })
      toast.success(approve ? "Approved: the money has moved" : "Adjustment rejected")
      onClose()
    },
  })
  const ready = password.length > 0 && (approve || text.trim().length >= 3)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{approve ? "Approve this adjustment?" : "Reject this adjustment?"}</DialogTitle>
          <DialogDescription>
            {adjustment.direction === "CREDIT" ? "Add" : "Take"} {formatMoney(adjustment.amount)} {adjustment.direction === "CREDIT" ? "to" : "from"}{" "}
            {adjustment.user.name}'s wallet. {approve ? "The money moves as soon as you approve." : "Nothing will move."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (ready) mutation.mutate()
          }}
        >
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          {approve && selfApprove && (
            <div className="flex gap-2.5 rounded-xl border border-amber-600/20 bg-amber-500/5 px-3 py-2.5 text-sm">
              <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden />
              <p>
                You're approving your own request, because no other admin can. It's recorded in the audit log as
                self-approved. Double-check the amount and the wallet before you continue.
              </p>
            </div>
          )}
          <p className="rounded-xl bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{selfApprove ? "Your reason:" : "Their reason:"}</span> {adjustment.reason}
          </p>
          <Field>
            <FieldLabel htmlFor="decision-text">{approve ? "Note (optional)" : "Why are you rejecting it?"}</FieldLabel>
            <Textarea id="decision-text" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="decision-password">Your password</FieldLabel>
            <Input id="decision-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || mutation.isPending} variant={approve ? "default" : "destructive"}>
              {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              {approve ? (selfApprove ? "Approve my own request" : "Approve") : "Reject"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
