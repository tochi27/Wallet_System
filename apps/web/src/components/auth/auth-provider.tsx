import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { authKeys, getMe, logout as logoutRequest } from "@/api/auth"
import { setUnauthorizedHandler } from "@/lib/api"
import { AuthContext, type AuthContextValue, type AuthStatus } from "@/lib/auth-context"
import { clearToken, getToken, setToken as storeToken, TOKEN_KEY } from "@/lib/token"

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [token, setToken] = useState<string | null>(() => getToken())

  const endSession = useCallback(() => {
    clearToken()
    setToken(null)
    queryClient.clear()
  }, [queryClient])

  useEffect(() => {
    setUnauthorizedHandler(endSession)
    return () => setUnauthorizedHandler(null)
  }, [endSession])

  // Keep tabs in sync: logging out (or in) in one tab applies to all of them
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== TOKEN_KEY) return
      if (event.newValue) {
        setToken(event.newValue)
      } else {
        setToken(null)
        queryClient.clear()
      }
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
  }, [queryClient])

  const {
    data: user,
    error,
    isError,
    refetch,
  } = useQuery({
    queryKey: authKeys.me,
    queryFn: getMe,
    enabled: token !== null,
    staleTime: 5 * 60 * 1000,
  })

  const signIn = useCallback(
    (newToken: string) => {
      queryClient.clear()
      storeToken(newToken)
      setToken(newToken)
    },
    [queryClient]
  )

  const signOut = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // The token is dropped locally either way; a failed blacklist call shouldn't trap the user
    }
    endSession()
  }, [endSession])

  const status: AuthStatus =
    token === null
      ? "unauthenticated"
      : user
        ? "authenticated"
        : isError
          ? "error"
          : "loading"

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: user ?? null,
      error,
      retry: () => void refetch(),
      signIn,
      signOut,
    }),
    [status, user, error, refetch, signIn, signOut]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
