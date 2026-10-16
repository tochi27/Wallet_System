import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, LandmarkIcon, PlusIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import { MIN_WITHDRAWAL, paymentKeys, startWithdrawal, useBankAccounts, type BankAccount } from "@/api/payments"
import { useBalance, walletKeys } from "@/api/wallet"
import { TextField } from "@/components/form/text-field"
import { AddBankAccountForm } from "@/components/payments/add-bank-account-form"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogClose, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { FieldGroup } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { useIdempotencyKey } from "@/lib/idempotency"
import { pinErrorKind } from "@/lib/pin"
import { PinConfirmStep } from "@/components/security/pin-confirm-step"
import { SetPinForm } from "@/components/security/set-pin-form"
import { formatMoney } from "@/lib/money"
import { cn } from "@/lib/utils"
import { withdrawalSchema, type WithdrawalValues } from "@/schemas/wallet"

const MAX_BANK_ACCOUNTS = 5

const FRIENDLY_ERRORS: Record<string, string> = {
  "Insufficient funds": "You don't have enough funds for this.",
}

// Withdraw dialog body: choose a saved bank account (or add one), then an amount
export function WithdrawForm({ onDone, initialAmount }: { onDone: () => void; initialAmount?: number }) {
  const { data: accounts, isPending } = useBankAccounts()
  const [adding, setAdding] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  if (isPending) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  const hasAccounts = (accounts?.length ?? 0) > 0
  if (adding || !hasAccounts) {
    return (
      <div className="flex flex-col gap-6">
        <DialogHeader>
          <DialogTitle>Add a bank account</DialogTitle>
          <DialogDescription>Withdrawals are paid into this account. Check the name before saving.</DialogDescription>
        </DialogHeader>
        <AddBankAccountForm
          onSaved={(account) => {
            setSelectedId(account.id)
            setAdding(false)
          }}
          onCancel={hasAccounts ? () => setAdding(false) : onDone}
          cancelLabel={hasAccounts ? "Back" : "Cancel"}
        />
      </div>
    )
  }

  const selected = accounts!.find((account) => account.id === selectedId) ?? accounts![0]
  return (
    <AmountStep
      accounts={accounts!}
      selected={selected}
      onSelect={setSelectedId}
      onAddAccount={accounts!.length < MAX_BANK_ACCOUNTS ? () => setAdding(true) : undefined}
      onDone={onDone}
      initialAmount={initialAmount}
    />
  )
}

type AmountStepProps = {
  accounts: BankAccount[]
  selected: BankAccount
  onSelect: (id: string) => void
  onAddAccount?: () => void
  onDone: () => void
  initialAmount?: number
}

function AmountStep({ accounts, selected, onSelect, onAddAccount, onDone, initialAmount }: AmountStepProps) {
  const queryClient = useQueryClient()
  const { data: balance } = useBalance()
  const { key, renew, renewIfRejected } = useIdempotencyKey()
  const { user } = useAuth()
  // Set when Paystack refused the transfer outright; the money is already back in the wallet
  const [refunded, setRefunded] = useState<string | null>(null)
  // details → (set-pin, first time only) → pin → done
  const [step, setStep] = useState<"details" | "set-pin" | "pin">("details")
  const [pending, setPending] = useState<WithdrawalValues | null>(null)

  const form = useForm<WithdrawalValues>({
    resolver: zodResolver(withdrawalSchema),
    defaultValues: { amount: initialAmount ? String(initialAmount) : "" },
  })

  const mutation = useMutation({
    mutationFn: ({ values, pin }: { values: WithdrawalValues; pin: string }) =>
      startWithdrawal(selected.id, Number(values.amount), pin, key),
    onSuccess: (withdrawal) => {
      void queryClient.invalidateQueries({ queryKey: walletKeys.all })
      void queryClient.invalidateQueries({ queryKey: paymentKeys.withdrawals })
      if (withdrawal.status === "FAILED" || withdrawal.status === "REVERSED") {
        setRefunded(withdrawal.failureReason ?? "The transfer didn't go through")
        renew()
        setStep("details")
        return
      }
      toast.success(
        `${formatMoney(withdrawal.amount)} is on its way to ${withdrawal.bankAccount.bankName} ••${withdrawal.bankAccount.accountNumberLast4}`
      )
      onDone()
    },
    onError: (error) => {
      renewIfRejected(error)
      const kind = pinErrorKind(error)
      if (kind === "not-set") setStep("set-pin")
      else if (kind === "other") setStep("details")
    },
  })
  const errorKind = mutation.isError ? pinErrorKind(mutation.error) : null

  // Any edit clears messages about the previous attempt
  const { isError, reset: clearError } = mutation
  useEffect(() => {
    if (!isError && !refunded) return
    return form.subscribe({
      formState: { values: true },
      callback: () => {
        clearError()
        setRefunded(null)
      },
    })
  }, [form, isError, refunded, clearError])

  if (step === "set-pin") {
    return (
      <div className="flex flex-col gap-6">
        <DialogHeader>
          <DialogTitle>Set your transaction PIN</DialogTitle>
          <DialogDescription>You'll use it to approve every withdrawal and transfer.</DialogDescription>
        </DialogHeader>
        <SetPinForm onDone={() => setStep("pin")} onCancel={() => setStep("details")} />
      </div>
    )
  }

  if (step === "pin" && pending) {
    return (
      <PinConfirmStep
        title="Confirm withdrawal"
        summary={
          <>
            Withdraw <strong>{formatMoney(pending.amount)}</strong> to {selected.bankName} ••{selected.accountNumberLast4}
          </>
        }
        confirmLabel="Withdraw"
        pending={mutation.isPending}
        error={errorKind === "pin" ? errorMessage(mutation.error) : null}
        onSubmit={(pin) => mutation.mutate({ values: pending, pin })}
        onBack={() => {
          mutation.reset()
          setStep("details")
        }}
      />
    )
  }

  return (
    <form
      onSubmit={form.handleSubmit((values) => {
        mutation.reset()
        setRefunded(null)
        setPending(values)
        setStep(user?.hasPin ? "pin" : "set-pin")
      })}
      noValidate
      className="flex flex-col gap-6"
    >
      <DialogHeader>
        <DialogTitle>Withdraw</DialogTitle>
        <DialogDescription>Send money from your wallet to your bank account.</DialogDescription>
      </DialogHeader>

      <FieldGroup>
        {errorKind === "other" && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>
              {FRIENDLY_ERRORS[errorMessage(mutation.error)] ?? errorMessage(mutation.error)}
            </AlertDescription>
          </Alert>
        )}
        {refunded && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{refunded}. The money is back in your wallet.</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" id="withdraw-to">
            To
          </span>
          <div role="radiogroup" aria-labelledby="withdraw-to" className="flex flex-col gap-2">
            {accounts.map((account) => {
              const checked = account.id === selected.id
              return (
                <button
                  key={account.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  onClick={() => onSelect(account.id)}
                  className={cn(
                    "flex items-center gap-3 rounded-xl border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    checked ? "border-primary bg-secondary/60" : "hover:bg-muted"
                  )}
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-primary" aria-hidden>
                    <LandmarkIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {account.bankName} ••{account.accountNumberLast4}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{account.accountName}</span>
                  </span>
                  <span
                    className={cn(
                      "size-4 shrink-0 rounded-full border-2",
                      checked ? "border-primary bg-primary shadow-[inset_0_0_0_3px_var(--card)]" : "border-input"
                    )}
                    aria-hidden
                  />
                </button>
              )
            })}
          </div>
          {onAddAccount && (
            <Button type="button" variant="ghost" size="sm" className="self-start" onClick={onAddAccount}>
              <PlusIcon aria-hidden />
              Add another account
            </Button>
          )}
        </div>

        <TextField
          control={form.control}
          name="amount"
          label="Amount"
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          autoFocus
          description={
            balance?.balance != null
              ? `Available: ${formatMoney(balance.balance)} · Minimum ${formatMoney(MIN_WITHDRAWAL)}`
              : `Minimum ${formatMoney(MIN_WITHDRAWAL)}`
          }
        />
      </FieldGroup>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            Cancel
          </Button>
        </DialogClose>
        <Button type="submit">Continue</Button>
      </DialogFooter>
    </form>
  )
}
