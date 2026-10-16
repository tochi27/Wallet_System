import { useState, type ReactNode } from "react"
import { AlertCircleIcon, Loader2Icon, LockKeyholeIcon } from "lucide-react"
import { PinInput } from "@/components/security/pin-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type PinConfirmStepProps = {
  title: string
  // What's about to happen, e.g. "Send ₦5,000.00 to grace@example.com"
  summary: ReactNode
  confirmLabel: string
  pending: boolean
  error: string | null
  onSubmit: (pin: string) => void
  onBack: () => void
}

// The last step before money leaves the wallet: shows what will happen and asks for the PIN
export function PinConfirmStep({ title, summary, confirmLabel, pending, error, onSubmit, onBack }: PinConfirmStepProps) {
  const [pin, setPin] = useState("")
  const ready = pin.length === 4 && !pending

  // Clears the boxes after each attempt, so a wrong PIN can be retyped straight away
  const submit = (value: string) => {
    if (pending) return
    onSubmit(value)
    setPin("")
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (ready) submit(pin)
      }}
    >
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>Enter your transaction PIN to confirm.</DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-5">
        <div className="flex w-full items-center gap-3 rounded-xl bg-muted px-4 py-3 text-sm">
          <LockKeyholeIcon className="size-4 shrink-0 text-primary" aria-hidden />
          <span>{summary}</span>
        </div>
        <PinInput
          label="Transaction PIN"
          value={pin}
          onChange={(value) => setPin(value)}
          // Submits as soon as the fourth digit is typed, as banking apps do
          onComplete={submit}
          autoFocus
          invalid={Boolean(error)}
          disabled={pending}
        />
        {error && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onBack} disabled={pending}>
          Back
        </Button>
        <Button type="submit" disabled={!ready}>
          {pending && <Loader2Icon className="animate-spin" aria-hidden />}
          {confirmLabel}
        </Button>
      </DialogFooter>
    </form>
  )
}
