import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { MIN_DEPOSIT, startDeposit } from "@/api/payments"
import { transfer, useBalance, walletKeys } from "@/api/wallet"
import { WithdrawForm } from "@/components/payments/withdraw-form"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { useIdempotencyKey } from "@/lib/idempotency"
import type { MoneyAction } from "@/lib/money-actions-context"
import { formatMoney } from "@/lib/money"
import { moneyActionSchema, type MoneyActionValues } from "@/schemas/wallet"

// Withdrawals have their own form (bank account + Paystack transfer); this one adds and sends money
type FormAction = Exclude<MoneyAction, "debit">

const COPY: Record<FormAction, { title: string; description: string; submit: string }> = {
  credit: {
    title: "Add money",
    description: "You'll pay securely through Paystack by card, bank transfer or USSD.",
    submit: "Continue to Paystack",
  },
  transfer: {
    title: "Send money",
    description: "Send money to another wallet user by their email.",
    submit: "Send",
  },
}

// Friendlier wording for the API's known client errors
const FRIENDLY_ERRORS: Record<string, string> = {
  "Insufficient funds": "You don't have enough funds for this.",
  "Receiver not found": "No wallet user has that email address.",
  "Cannot transfer to yourself": "You can't send money to yourself.",
}

type MoneyActionDialogProps = {
  action: MoneyAction | null
  onOpenChange: (open: boolean) => void
}

export function MoneyActionDialog({ action, onOpenChange }: MoneyActionDialogProps) {
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Content unmounts on close, so every open starts a fresh form and idempotency key */}
        {action === "debit" ? (
          <WithdrawForm onDone={() => onOpenChange(false)} />
        ) : (
          action && <MoneyActionForm action={action} onDone={() => onOpenChange(false)} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function MoneyActionForm({ action, onDone }: { action: FormAction; onDone: () => void }) {
  const copy = COPY[action]
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { data: balance } = useBalance()
  const { key, renewIfRejected } = useIdempotencyKey()
  // Set once Paystack's checkout link is ready; keeps the form locked while the browser leaves
  const [redirecting, setRedirecting] = useState(false)

  const form = useForm<MoneyActionValues>({
    resolver: zodResolver(moneyActionSchema(action)),
    defaultValues: { receiverEmail: "", amount: "", description: "" },
  })

  const mutation = useMutation({
    mutationFn: async (values: MoneyActionValues): Promise<{ checkoutUrl: string } | { amount: string }> => {
      const input = { amount: Number(values.amount), description: values.description || undefined }
      if (action === "credit") {
        // Adding money goes through Paystack; the wallet is credited once Paystack confirms
        const deposit = await startDeposit(input.amount, key)
        if (!deposit.authorizationUrl) throw new Error("Paystack did not return a checkout link")
        return { checkoutUrl: deposit.authorizationUrl }
      }
      return { amount: (await transfer({ ...input, receiverEmail: values.receiverEmail }, key)).sender.amount }
    },
    onSuccess: (result, values) => {
      if ("checkoutUrl" in result) {
        setRedirecting(true)
        window.location.assign(result.checkoutUrl)
        return
      }
      // Use the amount the server recorded — a replayed key returns the original result
      const formatted = formatMoney(result.amount)
      toast.success(`Sent ${formatted} to ${values.receiverEmail}`)
      void queryClient.invalidateQueries({ queryKey: walletKeys.all })
      onDone()
    },
    onError: renewIfRejected,
  })

  // Clear a server error as soon as the user edits the form, so it never describes stale input
  const { isError, reset: clearError } = mutation
  useEffect(() => {
    if (!isError) return
    return form.subscribe({ formState: { values: true }, callback: () => clearError() })
  }, [form, isError, clearError])

  const onSubmit = form.handleSubmit((values) => {
    if (action === "transfer" && values.receiverEmail.toLowerCase() === user?.email.toLowerCase()) {
      form.setError("receiverEmail", { message: "You can't send money to yourself" })
      return
    }
    mutation.mutate(values)
  })

  const showAvailable = action !== "credit" && balance?.balance != null
  const busy = mutation.isPending || redirecting

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
      <DialogHeader>
        <DialogTitle>{copy.title}</DialogTitle>
        <DialogDescription>{copy.description}</DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>
              {FRIENDLY_ERRORS[errorMessage(mutation.error)] ?? errorMessage(mutation.error)}
            </AlertDescription>
          </Alert>
        )}
        {action === "transfer" && (
          <TextField
            control={form.control}
            name="receiverEmail"
            label="Recipient email"
            type="email"
            autoComplete="off"
            placeholder="name@example.com"
            autoFocus
          />
        )}
        <TextField
          control={form.control}
          name="amount"
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          autoFocus={action !== "transfer"}
          description={
            showAvailable
              ? `Available: ${formatMoney(balance.balance)}`
              : action === "credit"
                ? `Minimum ${formatMoney(MIN_DEPOSIT)}`
                : undefined
          }
        />
        {/* Deposits are labelled "Deposit via Paystack"; notes apply to withdrawals and transfers */}
        {action !== "credit" && (
          <TextField
            control={form.control}
            name="description"
            label="Note (optional)"
            autoComplete="off"
            placeholder="e.g. Dinner split"
          />
        )}
      </FieldGroup>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit" disabled={busy}>
          {busy && <Loader2Icon className="animate-spin" aria-hidden />}
          {redirecting ? "Taking you to Paystack…" : copy.submit}
        </Button>
      </DialogFooter>
    </form>
  )
}
