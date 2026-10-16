import { useEffect, useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate, useSearchParams } from "react-router"
import { toast } from "sonner"
import { resetPassword } from "@/api/auth"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage, isApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { resetPasswordSchema, type ResetPasswordValues } from "@/schemas/auth"

const requestNewLink = (
  <Link to="/forgot-password" className="font-medium text-foreground underline underline-offset-4">
    Request a new link
  </Link>
)

export function ResetPasswordPage() {
  const { status, signOut } = useAuth()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Read the token once, then take it out of the address bar so it isn't left in history or shared by accident
  const [token] = useState(() => searchParams.get("token"))

  useEffect(() => {
    if (searchParams.has("token")) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  })

  const mutation = useMutation({
    mutationFn: ({ password }: ResetPasswordValues) => resetPassword(token ?? "", password),
    onSuccess: async () => {
      // Resetting signs out every device, including this one if it was signed in
      if (status === "authenticated") await signOut()
      toast.success("Password reset. Log in with your new password.")
      navigate("/login", { replace: true })
    },
  })

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">This link doesn't work</CardTitle>
          <CardDescription>
            Reset links work once and expire after 30 minutes. If you refreshed this page, open the link from your
            email again.
          </CardDescription>
        </CardHeader>
        <CardFooter className="justify-center text-sm">{requestNewLink}</CardFooter>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Choose a new password</CardTitle>
        <CardDescription>You'll be signed out on every device and can log in with the new password.</CardDescription>
      </CardHeader>
      <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))} noValidate>
        <CardContent>
          <FieldGroup>
            {mutation.isError && (
              <Alert variant="destructive">
                <AlertCircleIcon aria-hidden />
                <AlertDescription>
                  {errorMessage(mutation.error)}
                  {isApiError(mutation.error) && mutation.error.status === 400 && <> {requestNewLink}.</>}
                </AlertDescription>
              </Alert>
            )}
            <TextField
              control={form.control}
              name="password"
              label="New password"
              type="password"
              autoComplete="new-password"
              description="At least 8 characters."
              autoFocus
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm new password"
              type="password"
              autoComplete="new-password"
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-4">
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Reset password
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
