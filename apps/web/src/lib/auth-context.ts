import { createContext, useContext } from "react"
import type { User } from "@/api/auth"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated" | "error"

export type AuthContextValue = {
  status: AuthStatus
  user: User | null
  error: Error | null
  retry: () => void
  signIn: (token: string) => void
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>")
  return ctx
}
