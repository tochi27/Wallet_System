import { Navigate, Outlet, useLocation } from "react-router"
import { FullPageSpinner } from "@/components/full-page-spinner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { errorMessage, isApiError } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"

// Routes that need a logged-in user. Remembers where the user was headed so login can send them back.
export function RequireAuth() {
  const { status, error, retry, signOut } = useAuth()
  const location = useLocation()

  if (status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  if (status === "loading") return <FullPageSpinner />
  if (status === "error") {
    return (
      <div className="flex min-h-svh items-center justify-center px-4">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>Couldn't load your account</CardTitle>
            <CardDescription>{errorMessage(error)}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            {isApiError(error) && error.status === 429
              ? "You've made a lot of requests in a short time. Wait a minute, then try again."
              : "The server may be waking up — this can take up to a minute."}
          </CardContent>
          <CardFooter className="gap-2">
            <Button onClick={retry}>Try again</Button>
            <Button variant="outline" onClick={() => void signOut()}>
              Log out
            </Button>
          </CardFooter>
        </Card>
      </div>
    )
  }
  return <Outlet />
}

// Login and signup — logged-in users are sent to the app instead
export function GuestOnly() {
  const { status } = useAuth()

  if (status === "authenticated") return <Navigate to="/" replace />
  if (status === "loading") return <FullPageSpinner />
  return <Outlet />
}
