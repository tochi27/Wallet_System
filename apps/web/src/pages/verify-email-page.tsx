import { useEffect, useRef, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon, Loader2Icon, XCircleIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { authKeys, verifyEmail } from "@/api/auth"
import { Button } from "@/components/ui/button"
import { Card, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"

export function VerifyEmailPage() {
  const { status } = useAuth()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // Read the token once, then take it out of the address bar so it isn't left in history or shared by accident
  const [token] = useState(() => searchParams.get("token"))
  const started = useRef(false)

  const mutation = useMutation({
    mutationFn: verifyEmail,
    // A signed-in user's banner and money buttons update straight away
    onSuccess: () => queryClient.invalidateQueries({ queryKey: authKeys.me }),
  })

  useEffect(() => {
    if (searchParams.has("token")) setSearchParams({}, { replace: true })
  }, [searchParams, setSearchParams])

  // Verify as soon as the page opens; the ref stops React's development double-run sending it twice
  useEffect(() => {
    if (!token || started.current) return
    started.current = true
    mutation.mutate(token)
  }, [token, mutation])

  const signedIn = status === "authenticated"
  const next = (
    <Button asChild className="w-full">
      <Link to={signedIn ? "/" : "/login"} replace>
        {signedIn ? "Go to your wallet" : "Log in"}
      </Link>
    </Button>
  )

  if (!token || mutation.isError) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <XCircleIcon className="mb-2 size-10 text-destructive" aria-hidden />
          <CardTitle className="text-xl">This link doesn't work</CardTitle>
          <CardDescription>
            {mutation.isError
              ? errorMessage(mutation.error)
              : "Verification links work once and expire after 24 hours. If you refreshed this page, open the link from your email again."}{" "}
            {signedIn
              ? "You can send yourself a new link from the banner at the top of the app."
              : "Log in and send yourself a new link from the banner at the top of the app."}
          </CardDescription>
        </CardHeader>
        <CardFooter>{next}</CardFooter>
      </Card>
    )
  }

  if (!mutation.isSuccess) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <Loader2Icon className="mb-2 size-10 animate-spin text-muted-foreground" aria-hidden />
          <CardTitle className="text-xl">Verifying your email…</CardTitle>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <CheckCircle2Icon className="mb-2 size-10 text-primary" aria-hidden />
        <CardTitle className="text-xl">
          {mutation.data === "verified" ? "Email verified" : "Your email is already verified"}
        </CardTitle>
        <CardDescription>You can now add, send and withdraw money.</CardDescription>
      </CardHeader>
      <CardFooter>{next}</CardFooter>
    </Card>
  )
}
