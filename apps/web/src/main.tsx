import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { RouterProvider } from "react-router"
import { Toaster } from "@/components/ui/sonner"
import { isApiError } from "@/lib/api"
import { AuthProvider } from "@/components/auth/auth-provider"
import { ThemeProvider } from "@/components/theme-provider"
import { router } from "@/router"
import "./index.css"

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Reuse data fetched in the last 30s when moving between pages — the API rate-limits
      // wallet reads, and every page mount would otherwise refetch everything
      staleTime: 30_000,
      // 4xx responses won't change on retry; network blips and 5xx might
      retry: (failureCount, error) => {
        if (isApiError(error) && error.status >= 400 && error.status < 500) return false
        return failureCount < 2
      },
    },
  },
})

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <RouterProvider router={router} />
        </AuthProvider>
        <Toaster richColors />
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>
)
