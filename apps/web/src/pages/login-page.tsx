import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { useForm } from "react-hook-form"
import { Link, useLocation, useNavigate } from "react-router"
import { login } from "@/api/auth"
import { TextField } from "@/components/form/text-field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { FieldGroup } from "@/components/ui/field"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { loginSchema, type LoginValues } from "@/schemas/auth"

export function LoginPage() {
  const { signIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { from?: string; email?: string } | null
  const from = state?.from ?? "/"

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: state?.email ?? "", password: "" },
  })

  const mutation = useMutation({
    mutationFn: login,
    onSuccess: (token) => {
      signIn(token)
      navigate(from, { replace: true })
    },
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">Log in</CardTitle>
        <CardDescription>Welcome back. Enter your details to access your wallet.</CardDescription>
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
            <TextField
              control={form.control}
              name="email"
              label="Email"
              type="email"
              autoComplete="email"
              autoFocus={!state?.email}
            />
            <TextField
              control={form.control}
              name="password"
              label="Password"
              type="password"
              autoComplete="current-password"
              autoFocus={Boolean(state?.email)}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-6 flex-col gap-4">
          <Button type="submit" className="w-full" disabled={mutation.isPending}>
            {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Log in
          </Button>
          <p className="text-sm text-muted-foreground">
            Don't have an account?{" "}
            <Link to="/signup" className="font-medium text-foreground underline underline-offset-4">
              Sign up
            </Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  )
}
