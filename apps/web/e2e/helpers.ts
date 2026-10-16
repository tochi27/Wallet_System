import { createHash, randomBytes } from "node:crypto"
import { PrismaClient, type Role } from "@prisma/client"
import type { Page } from "@playwright/test"
import { E2E } from "./env.mjs"

// Direct database access, only for what a test can't do through the app: reading the link a real
// email would carry, or granting a staff role the way the admin:grant script does
export const db = new PrismaClient({ datasourceUrl: E2E.databaseUrl })

export const PASSWORD = "Password123"
export const PIN = "2580"

export type TestUser = { id: string; name: string; email: string; token: string }

export const uniqueEmail = (label: string) =>
  `${label}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}@example.com`

export async function api<T = unknown>(path: string, init: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${E2E.apiUrl}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: { "Content-Type": "application/json", ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const payload = (await res.json().catch(() => ({}))) as { data?: T; message?: string }
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${path} → ${res.status}: ${payload.message}`)
  return payload.data as T
}

/**
 * A user made the quick way, through the API: signed up, and by default with a verified email.
 * Optionally with a PIN, money (development funding) and a staff role.
 */
export async function createUser(
  name: string,
  options: { verified?: boolean; pin?: boolean; balance?: number; role?: Role } = {}
): Promise<TestUser> {
  const { verified = true, pin = false, balance = 0, role } = options
  const email = uniqueEmail(name.split(" ")[0].toLowerCase())
  const { user } = await api<{ user: { id: string } }>("/api/auth/signup", { body: { name, email, password: PASSWORD } })
  if (verified || role) {
    await db.user.update({ where: { id: user.id }, data: { ...(verified && { emailVerifiedAt: new Date() }), ...(role && { role }) } })
  }
  const { token } = await api<{ token: string }>("/api/auth/login", { body: { email, password: PASSWORD } })
  if (pin) await api("/api/account/pin", { token, body: { password: PASSWORD, pin: PIN } })
  if (balance > 0) await api("/api/wallet/credit", { token, body: { amount: balance } })
  return { id: user.id, name, email, token }
}

/** Opens the app already signed in as this user. */
export async function signIn(page: Page, user: TestUser, path = "/") {
  await page.goto("/login")
  await page.evaluate((token) => localStorage.setItem("wallet.token", token), user.token)
  await page.goto(path)
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** The link the verification email would carry (the app stores only its hash, so make a new one). */
export async function verificationLink(userId: string) {
  const token = randomBytes(32).toString("base64url")
  await db.emailVerificationToken.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 60 * 60_000) },
  })
  return `/verify-email?token=${token}`
}

/** The link a password reset email would carry. */
export async function resetLink(userId: string) {
  const token = randomBytes(32).toString("base64url")
  await db.passwordResetToken.create({
    data: { userId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 30 * 60_000) },
  })
  return `/reset-password?token=${token}`
}

export const naira = (amount: number) =>
  new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN" }).format(amount)
