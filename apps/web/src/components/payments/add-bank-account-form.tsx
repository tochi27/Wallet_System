import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, CheckCircle2Icon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { addBankAccount, paymentKeys, useBanks, useResolvedAccount, type BankAccount } from "@/api/payments"
import { BankPicker } from "@/components/payments/bank-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/api"

// Paystack's test-mode bank: any 10-digit number resolves, with no daily limit
const TEST_BANK_CODE = "001"

type AddBankAccountFormProps = {
  onSaved: (account: BankAccount) => void
  onCancel?: () => void
  cancelLabel?: string
}

/**
 * Pick a bank, type the 10-digit account number, and the holder's name is looked up for the user
 * to confirm before saving. The server looks it up again on save, so the name can't be faked.
 */
export function AddBankAccountForm({ onSaved, onCancel, cancelLabel = "Back" }: AddBankAccountFormProps) {
  const queryClient = useQueryClient()
  const [bankCode, setBankCode] = useState<string | null>(null)
  const [accountNumber, setAccountNumber] = useState("")
  const lookup = useResolvedAccount(bankCode, accountNumber)
  // The API only lists Paystack's test bank when it runs on a test key
  const { data: banks } = useBanks()
  const testMode = banks?.some((bank) => bank.code === TEST_BANK_CODE) ?? false

  const save = useMutation({
    mutationFn: () => addBankAccount(bankCode!, accountNumber),
    onSuccess: (account) => {
      queryClient.setQueryData<BankAccount[]>(paymentKeys.bankAccounts, (old) => [
        ...(old ?? []).filter((existing) => existing.id !== account.id),
        account,
      ])
      toast.success(`${account.bankName} ••${account.accountNumberLast4} saved`)
      onSaved(account)
    },
  })

  const confirmed = lookup.data && !lookup.isFetching

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (confirmed) save.mutate()
      }}
    >
      <FieldGroup>
        {save.isError && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{errorMessage(save.error)}</AlertDescription>
          </Alert>
        )}
        <Field>
          <FieldLabel htmlFor="bank">Bank</FieldLabel>
          <BankPicker id="bank" value={bankCode} onChange={setBankCode} />
          {testMode && bankCode !== TEST_BANK_CODE && (
            <FieldDescription>
              Test mode: Paystack allows 3 lookups of real bank accounts a day.{" "}
              <button
                type="button"
                className="font-medium text-primary underline underline-offset-4"
                onClick={() => setBankCode(TEST_BANK_CODE)}
              >
                Use Paystack Test Bank
              </button>{" "}
              with any 10-digit number to test freely.
            </FieldDescription>
          )}
        </Field>
        <Field data-invalid={lookup.isError}>
          <FieldLabel htmlFor="accountNumber">Account number</FieldLabel>
          <Input
            id="accountNumber"
            inputMode="numeric"
            autoComplete="off"
            placeholder="10 digits"
            value={accountNumber}
            aria-invalid={lookup.isError}
            onChange={(event) => setAccountNumber(event.target.value.replace(/\D/g, "").slice(0, 10))}
          />
          {/* Live result of the name lookup */}
          <div aria-live="polite" className="min-h-5 text-sm">
            {lookup.isFetching ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Loader2Icon className="size-4 animate-spin" aria-hidden />
                Checking account…
              </span>
            ) : lookup.isError ? (
              <span className="text-destructive">{errorMessage(lookup.error)}</span>
            ) : lookup.data ? (
              <span className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-success">
                <CheckCircle2Icon className="size-4 shrink-0" aria-hidden />
                <span>
                  <span className="font-semibold">{lookup.data.accountName}</span>
                  <span className="text-success/80"> · {lookup.data.bankName}</span>
                </span>
              </span>
            ) : (
              <FieldDescription>We'll look up the account holder's name so you can check it.</FieldDescription>
            )}
          </div>
        </Field>
      </FieldGroup>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" disabled={!confirmed || save.isPending}>
          {save.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Save account
        </Button>
      </div>
    </form>
  )
}
