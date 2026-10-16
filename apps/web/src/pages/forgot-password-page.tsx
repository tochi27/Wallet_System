import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon, MailCheckIcon } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link } from "react-router"
import { requestPasswordReset } from "@/api/auth"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage } from "@/lib/api"
import { forgotPasswordSchema, type ForgotPasswordValues } from "@/schemas/auth"

const backToLogin = (
  <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
    Back to log in
  </Link>
)

export function ForgotPasswordPage() {
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  })

  const mutation = useMutation({
    mutationFn: ({ email }: ForgotPasswordValues) => requestPasswordReset(email),
  })

  // The server answers the same way for every address, so this never says whether the email is registered
  if (mutation.isSuccess) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-xl">
            <MailCheckIcon className="size-5 text-primary" aria-hidden />
            Check your email
          </CardTitle>
          <CardDescription>
            If an account exists for {mutation.variables.email}, we've sent a link to reset the password. It works
            once and expires in 30 minutes.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Nothing there? Check your spam folder, or wait 2 minutes and{" "}
          <button
            type="button"
            className="font-medium text-foreground underline underline-offset-4"
            onClick={() => mutation.reset()}
          >
            try again
          </button>
          .
        </CardContent>
        <CardFooter className="justify-center text-sm">{backToLogin}</CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Forgot your password?</CardTitle>
        <CardDescription>Enter your email and we'll send you a link to choose a new one.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
        <CardContent>
          <FieldGroup>
            {mutation.isError && (
              <Alert variant="destructive">
                <AlertCircleIcon aria-hidden />
                <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
              </Alert>
            )}
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" autoFocus />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-4">
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Send reset link
          </Button>
          <p className="text-sm text-muted-foreground">{backToLogin}</p>
        </CardFooter>
      </form>
    </Card>
  )
}
