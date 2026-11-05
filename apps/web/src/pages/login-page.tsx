import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, Loader2Icon, SparklesIcon } from "lucide-react"
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
import { demo } from "@/lib/demo"
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
    <div className="flex flex-col gap-4">
      {demo.enabled && (
        <div className="flex flex-col gap-3 rounded-2xl border border-primary/25 bg-primary/5 p-4 text-sm">
          <p className="flex items-center gap-2 font-medium">
            <SparklesIcon className="size-4 text-primary" aria-hidden />
            Exploring PurpleWallet? Use the demo account
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-muted-foreground">
            <dt>Email</dt>
            <dd className="font-mono text-foreground">{demo.email}</dd>
            <dt>Password</dt>
            <dd className="font-mono text-foreground">{demo.password}</dd>
            <dt>PIN</dt>
            <dd className="font-mono text-foreground">{demo.pin}</dd>
          </dl>
          <p className="text-xs text-muted-foreground">
            It's shared with everyone trying the demo, and the money isn't real. Sign up to get your own account.
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate({ email: demo.email, password: demo.password })}
          >
            Use the demo account
          </Button>
        </div>
      )}
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
              <Link
                to="/forgot-password"
                className="-mt-4 self-end text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Forgot password?
              </Link>
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
    </div>
  )
}
