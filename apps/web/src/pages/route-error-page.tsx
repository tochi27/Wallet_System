import { AlertTriangleIcon, RotateCwIcon } from "lucide-react"
import { isRouteErrorResponse, useRouteError } from "react-router"
import { NotFoundPage } from "@/pages/not-found-page"
import { Button } from "@/components/ui/button"

// After a deploy, an open tab can ask for code files that no longer exist
const isStaleBuild = (error: unknown) =>
  error instanceof Error &&
  /dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(error.message)

/**
 * Shown when a page crashes, instead of React Router's developer screen. The buttons do a full
 * page load rather than client-side navigation, since the app's state may be what broke.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />

  const stale = isStaleBuild(error)
  const detail = error instanceof Error ? error.message : isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : String(error)

  return (
    <div className="page-glow flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangleIcon className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">{stale ? "PurpleWallet has been updated" : "Something went wrong"}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        {stale
          ? "Reload the page to get the latest version."
          : "This page ran into a problem. Your money and account are safe. Try reloading, or go back to the home page."}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => window.location.reload()}>
          <RotateCwIcon aria-hidden />
          Reload
        </Button>
        <Button variant="outline" asChild>
          <a href="/">Go home</a>
        </Button>
      </div>
      {/* The technical detail helps while developing; users never see it */}
      {import.meta.env.DEV && (
        <pre className="mt-4 max-w-2xl overflow-auto rounded-xl bg-muted p-4 text-left font-mono text-xs whitespace-pre-wrap text-muted-foreground">
          {detail}
        </pre>
      )}
    </div>
  )
}
