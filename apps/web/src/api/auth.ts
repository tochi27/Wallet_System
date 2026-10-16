import { api } from "@/lib/api"
import type { Role } from "@/lib/permissions"

export type User = {
  id: string
  name: string
  email: string
  createdAt: string
  hasPin: boolean
  // Only set while transfers and withdrawals are locked after too many wrong PINs
  pinLockedUntil: string | null
  emailNotifications: boolean
  // Opted in to AI spending insights
  aiInsightsEnabled: boolean
  passwordChangedAt: string | null
  role: Role
  // On hold: can sign in and receive money, but not send or withdraw
  frozen: boolean
  // Money can't move until the user follows the link in their verification email
  emailVerified: boolean
}

export type LoginInput = { email: string; password: string }
export type SignupInput = { name: string; email: string; password: string }

export const authKeys = {
  me: ["auth", "me"] as const,
}

export async function login(input: LoginInput) {
  const { token } = await api<{ token: string }>("/api/auth/login", { method: "POST", body: input })
  return token
}

export async function signup(input: SignupInput) {
  const { user } = await api<{ user: User }>("/api/auth/signup", { method: "POST", body: input })
  return user
}

export async function logout() {
  await api<Record<string, never>>("/api/auth/logout", { method: "POST" })
}

export async function getMe() {
  const { user } = await api<{ user: User }>("/api/auth/me")
  return user
}

// Always succeeds with the same message, whether or not the email has an account
export async function requestPasswordReset(email: string) {
  await api<Record<string, never>>("/api/auth/forgot-password", { method: "POST", body: { email } })
}

export async function resetPassword(token: string, password: string) {
  await api<Record<string, never>>("/api/auth/reset-password", { method: "POST", body: { token, password } })
}

// Works signed in or not: the link itself proves the user owns the inbox
export async function verifyEmail(token: string) {
  const { status } = await api<{ status: "verified" | "already_verified" }>("/api/auth/verify-email", {
    method: "POST",
    body: { token },
  })
  return status
}

export async function resendVerification() {
  await api<Record<string, never>>("/api/auth/resend-verification", { method: "POST" })
}
