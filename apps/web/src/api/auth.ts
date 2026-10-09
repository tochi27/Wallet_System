import { api } from "@/lib/api"

export type User = {
  id: string
  name: string
  email: string
  createdAt: string
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
