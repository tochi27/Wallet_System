import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { changePin } from "@/api/account"
import { PinInput } from "@/components/security/pin-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/api"
import { pinProblem } from "@/lib/pin"

// Change the PIN, proving it's you with the current PIN — or the password if it's forgotten
export function ChangePinForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [useMyPassword, setUseMyPassword] = useState(false)
  const [currentPin, setCurrentPin] = useState("")
  const [password, setPassword] = useState("")
  const [newPin, setNewPin] = useState("")
  const [confirm, setConfirm] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => changePin(useMyPassword ? { password } : { currentPin }, newPin),
    onSuccess: () => {
      toast.success("Transaction PIN changed")
      onDone()
    },
  })

  const submit = () => {
    const proofMissing = useMyPassword ? !password : currentPin.length !== 4
    const issue = proofMissing
      ? useMyPassword
        ? "Enter your account password"
        : "Enter your current PIN"
      : pinProblem(newPin) ?? (newPin !== confirm ? "The new PINs don't match" : null)
    setProblem(issue)
    if (!issue) mutation.mutate()
  }

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        submit()
      }}
    >
      <FieldGroup>
        {(problem || mutation.isError) && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{problem ?? errorMessage(mutation.error)}</AlertDescription>
          </Alert>
        )}
        {useMyPassword ? (
          <Field>
            <FieldLabel htmlFor="change-password">Account password</FieldLabel>
            <Input
              id="change-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoFocus
            />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="current-pin">Current PIN</FieldLabel>
            <PinInput id="current-pin" label="Current PIN" value={currentPin} onChange={setCurrentPin} autoFocus />
          </Field>
        )}
        <button
          type="button"
          className="-mt-2 self-start text-sm font-medium text-primary underline underline-offset-4"
          onClick={() => setUseMyPassword((value) => !value)}
        >
          {useMyPassword ? "Use my current PIN instead" : "Forgot your PIN? Use your password"}
        </button>
        <Field>
          <FieldLabel htmlFor="changed-pin">New PIN</FieldLabel>
          <PinInput id="changed-pin" label="New PIN" value={newPin} onChange={setNewPin} />
        </Field>
        <Field>
          <FieldLabel htmlFor="changed-pin-confirm">Confirm new PIN</FieldLabel>
          <PinInput id="changed-pin-confirm" label="Confirm new PIN" value={confirm} onChange={setConfirm} />
        </Field>
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Change PIN
        </Button>
      </div>
    </form>
  )
}
