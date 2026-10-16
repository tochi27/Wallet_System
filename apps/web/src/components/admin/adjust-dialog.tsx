import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { adminKeys, APPROVAL_THRESHOLD, createAdjustment, type AdjustmentDirection, type AdjustmentKind } from "@/api/admin"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { errorMessage } from "@/lib/api"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

const KINDS: Record<AdjustmentKind, { label: string; userSees: string }> = {
  REFUND: { label: "Refund", userSees: "Refund from PurpleWallet" },
  GOODWILL: { label: "Goodwill credit", userSees: "Credit from PurpleWallet" },
  CORRECTION: { label: "Correction", userSees: "Balance correction" },
}

const selectClass = "h-9 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

/**
 * Credits or debits a user's wallet. Up to ₦10,000 it applies at once; above that a different
 * admin must approve it. Needs the admin's password, and every step is in the audit log.
 */
export function AdjustDialog({ userId, userName, balance, open, onOpenChange }: { userId: string; userName: string; balance: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [direction, setDirection] = useState<AdjustmentDirection>("CREDIT")
  const [kind, setKind] = useState<AdjustmentKind>("REFUND")
  const [amount, setAmount] = useState("")
  const [reason, setReason] = useState("")
  const [password, setPassword] = useState("")

  const reset = () => {
    setDirection("CREDIT")
    setKind("REFUND")
    setAmount("")
    setReason("")
    setPassword("")
    mutation.reset()
  }

  const mutation = useMutation({
    mutationFn: () => createAdjustment(userId, { direction, kind: direction === "DEBIT" ? "CORRECTION" : kind, amount: Number(amount), reason: reason.trim(), password }),
    onSuccess: (adjustment) => {
      void queryClient.invalidateQueries({ queryKey: adminKeys.all })
      toast.success(adjustment.status === "APPROVED" ? "Balance adjusted" : "Sent for a second admin to approve")
      reset()
      onOpenChange(false)
    },
  })

  const value = Number(amount)
  const validAmount = Number.isFinite(value) && value > 0 && /^\d+(\.\d{1,2})?$/.test(amount)
  const needsApproval = validAmount && value > APPROVAL_THRESHOLD
  const overdraw = direction === "DEBIT" && validAmount && value > Number(balance)
  const ready = validAmount && !overdraw && reason.trim().length >= 3 && password.length > 0

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adjust {userName.split(" ")[0]}'s balance</DialogTitle>
          <DialogDescription>Current balance {formatMoney(balance)}. This is recorded permanently in the ledger and audit log.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (ready) mutation.mutate()
          }}
        >
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-2 gap-1 rounded-full bg-muted p-1" role="radiogroup" aria-label="Direction">
            {(["CREDIT", "DEBIT"] as const).map((d) => (
              <button
                key={d}
                type="button"
                role="radio"
                aria-checked={direction === d}
                onClick={() => setDirection(d)}
                className={cn("rounded-full py-1.5 text-sm font-medium", direction === d ? "bg-card shadow-sm" : "text-muted-foreground")}
              >
                {d === "CREDIT" ? "Add money" : "Take money"}
              </button>
            ))}
          </div>

          <Field>
            <FieldLabel htmlFor="adjust-kind">Type</FieldLabel>
            {direction === "CREDIT" ? (
              <select id="adjust-kind" value={kind} onChange={(e) => setKind(e.target.value as AdjustmentKind)} className={selectClass}>
                {(Object.keys(KINDS) as AdjustmentKind[]).map((k) => (
                  <option key={k} value={k}>
                    {KINDS[k].label}
                  </option>
                ))}
              </select>
            ) : (
              <p className="text-sm">Correction (the only way to take money)</p>
            )}
            <FieldDescription>They'll see "{KINDS[direction === "DEBIT" ? "CORRECTION" : kind].userSees}" and get a notification.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="adjust-amount">Amount (₦)</FieldLabel>
            <Input id="adjust-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.trim())} placeholder="0.00" />
            {overdraw ? (
              <FieldDescription className="text-destructive">That's more than their balance.</FieldDescription>
            ) : needsApproval ? (
              <FieldDescription>Above {formatMoney(APPROVAL_THRESHOLD)}, so it needs approving in Admin → Adjustments before the money moves (by a different admin, if there is one).</FieldDescription>
            ) : (
              <FieldDescription>Up to {formatMoney(APPROVAL_THRESHOLD)} applies straight away.</FieldDescription>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="adjust-reason">Reason</FieldLabel>
            <Textarea id="adjust-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Duplicate card charge on 3 Oct, Paystack ref …" />
            <FieldDescription>Internal: the user doesn't see this.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="adjust-password">Your password</FieldLabel>
            <Input id="adjust-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready || mutation.isPending} variant={direction === "DEBIT" ? "destructive" : "default"}>
              {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              {needsApproval ? "Send for approval" : direction === "CREDIT" ? "Add money" : "Take money"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
