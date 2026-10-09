import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { LandmarkIcon, Loader2Icon, PlusIcon, Trash2Icon } from "lucide-react"
import { toast } from "sonner"
import { paymentKeys, removeBankAccount, useBankAccounts, type BankAccount } from "@/api/payments"
import { AddBankAccountForm } from "@/components/payments/add-bank-account-form"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

const MAX_BANK_ACCOUNTS = 5

const label = (account: BankAccount) => `${account.bankName} ••${account.accountNumberLast4}`

export function BankAccountsCard({ className }: { className?: string }) {
  const queryClient = useQueryClient()
  const { data: accounts, isPending, isError, error, refetch } = useBankAccounts()
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<BankAccount | null>(null)

  const remove = useMutation({
    mutationFn: (account: BankAccount) => removeBankAccount(account.id),
    onSuccess: (_result, account) => {
      queryClient.setQueryData<BankAccount[]>(paymentKeys.bankAccounts, (old) =>
        (old ?? []).filter((existing) => existing.id !== account.id)
      )
      toast.success(`${label(account)} removed`)
      setRemoving(null)
    },
  })

  return (
    <Card className={cn("rounded-3xl border-0 shadow-soft ring-1 ring-border/70", className)}>
      <CardHeader>
        <CardTitle>Bank accounts</CardTitle>
        <CardDescription>Where your withdrawals are paid</CardDescription>
        {accounts && accounts.length > 0 && accounts.length < MAX_BANK_ACCOUNTS && (
          <CardAction>
            <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              Add
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : isError ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-destructive">{errorMessage(error)}</p>
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              Try again
            </Button>
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-start gap-3 py-2">
            <p className="text-sm text-muted-foreground">Add a bank account to withdraw money from your wallet.</p>
            <Button size="sm" className="rounded-full" onClick={() => setAdding(true)}>
              <PlusIcon aria-hidden />
              Add bank account
            </Button>
          </div>
        ) : (
          <ul className="divide-y">
            {accounts.map((account) => (
              <li key={account.id} className="flex items-center gap-3 py-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-primary" aria-hidden>
                  <LandmarkIcon className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{label(account)}</p>
                  <p className="truncate text-xs text-muted-foreground">{account.accountName}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setRemoving(account)}
                  aria-label={`Remove ${label(account)}`}
                  title="Remove"
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add a bank account</DialogTitle>
            <DialogDescription>Withdrawals are paid into this account. Check the name before saving.</DialogDescription>
          </DialogHeader>
          {adding && <AddBankAccountForm onSaved={() => setAdding(false)} onCancel={() => setAdding(false)} cancelLabel="Cancel" />}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {removing && label(removing)}?</DialogTitle>
            <DialogDescription>
              You won't be able to withdraw to it unless you add it again. Past withdrawals aren't affected.
            </DialogDescription>
          </DialogHeader>
          {remove.isError && <p className="text-sm text-destructive">{errorMessage(remove.error)}</p>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() => removing && remove.mutate(removing)}
            >
              {remove.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
