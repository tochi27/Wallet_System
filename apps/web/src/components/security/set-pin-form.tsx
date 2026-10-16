import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { setPin } from "@/api/account"
import { authKeys } from "@/api/auth"
import { PinInput } from "@/components/security/pin-input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { errorMessage } from "@/lib/api"
import { pinProblem } from "@/lib/pin"

type SetPinFormProps = {
  onDone: () => void
  onCancel?: () => void
  cancelLabel?: string
}

// First-time PIN: account password + new PIN + confirmation
export function SetPinForm({ onDone, onCancel, cancelLabel = "Back" }: SetPinFormProps) {
  const queryClient = useQueryClient()
  const [password, setPassword] = useState("")
  const [pin, setPinValue] = useState("")
  const [confirm, setConfirm] = useState("")
  const [problem, setProblem] = useState<string | null>(null)

  const mutation = useMutation({
    mutationFn: () => setPin(password, pin),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: authKeys.me })
      toast.success("Transaction PIN set")
      onDone()
    },
  })

  const submit = () => {
    const issue = !password ? "Enter your account password" : pinProblem(pin) ?? (pin !== confirm ? "The PINs don't match" : null)
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
        <Field>
          <FieldLabel htmlFor="pin-password">Account password</FieldLabel>
          <Input
            id="pin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus
          />
          <FieldDescription>To make sure it's really you.</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="new-pin">New 4-digit PIN</FieldLabel>
          <PinInput id="new-pin" label="New PIN" value={pin} onChange={setPinValue} />
        </Field>
        <Field>
          <FieldLabel htmlFor="confirm-pin">Confirm PIN</FieldLabel>
          <PinInput id="confirm-pin" label="Confirm PIN" value={confirm} onChange={setConfirm} />
          <FieldDescription>Avoid easy PINs like 1111 or 1234.</FieldDescription>
        </Field>
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
        )}
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Set PIN
        </Button>
      </div>
    </form>
  )
}
