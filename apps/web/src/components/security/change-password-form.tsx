import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link } from "react-router"
import { toast } from "sonner"
import { changePassword } from "@/api/account"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { changePasswordSchema, type ChangePasswordValues } from "@/schemas/auth"

// Change the password while signed in. Other devices are signed out; this one gets a fresh token.
export function ChangePasswordForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const { replaceToken } = useAuth()

  const form = useForm<ChangePasswordValues>({
    resolver: zodResolver(changePasswordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  })

  const mutation = useMutation({
    mutationFn: ({ currentPassword, newPassword }: ChangePasswordValues) => changePassword(currentPassword, newPassword),
    onSuccess: ({ token }) => {
      replaceToken(token)
      toast.success("Password changed. Your other devices have been signed out.")
      onDone()
    },
  })

  return (
    <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate className="flex flex-col gap-6">
      <FieldGroup>
        {mutation.isError && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
          </Alert>
        )}
        <TextField
          control={form.control}
          name="currentPassword"
          label="Current password"
          type="password"
          autoComplete="current-password"
          autoFocus
        />
        <Link
          to="/forgot-password"
          className="-mt-4 self-end text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Forgot it?
        </Link>
        <TextField
          control={form.control}
          name="newPassword"
          label="New password"
          type="password"
          autoComplete="new-password"
          description="At least 8 characters."
        />
        <TextField
          control={form.control}
          name="confirmPassword"
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
        />
      </FieldGroup>
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
          Change password
        </Button>
      </div>
    </form>
  )
}
