import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import { login, signup } from "@/api/auth"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { signupSchema, type SignupValues } from "@/schemas/auth"

export function SignupPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()

  const form = useForm<SignupValues>({
    resolver: zodResolver(signupSchema),
    defaultValues: { name: "", email: "", password: "", confirmPassword: "" },
  })

  // Signup doesn't return a token, so log straight in with the same credentials.
  // If that login fails (e.g. rate limited), the account still exists — send the
  // user to the login page rather than showing an error that invites a duplicate signup.
  const mutation = useMutation({
    mutationFn: async ({ name, email, password }: SignupValues) => {
      const user = await signup({ name, email, password })
      const token = await login({ email, password }).catch(() => null)
      return { user, token }
    },
    onSuccess: ({ user, token }) => {
      if (!token) {
        toast.success("Account created. Please log in.")
        navigate("/login", { replace: true, state: { email: user.email } })
        return
      }
      signIn(token)
      toast.success(`Welcome, ${user.name}! Your wallet is ready.`)
      navigate("/", { replace: true })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Create an account</CardTitle>
        <CardDescription>A wallet is created for you automatically.</CardDescription>
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
            <TextField control={form.control} name="name" label="Name" autoComplete="name" autoFocus />
            <TextField control={form.control} name="email" label="Email" type="email" autoComplete="email" />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              description="At least 8 characters."
            />
            <TextField
              control={form.control}
              name="confirmPassword"
              label="Confirm password"
              type="password"
              autoComplete="new-password"
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-4">
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Create account
          </Button>
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link to="/login" className="font-medium text-foreground underline underline-offset-4">
              Log in
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
