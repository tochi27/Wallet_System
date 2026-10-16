import { isApiError } from "@/lib/api"

// Mirrors the API's rules (apps/api/src/validators/account.validators.ts)
export function pinProblem(pin: string): string | null {
  if (!/^\d{4}$/.test(pin)) return "Your PIN must be 4 digits"
  if (/^(\d)\1{3}$/.test(pin) || "0123456789".includes(pin) || "9876543210".includes(pin)) {
    return "Choose a less guessable PIN (not 1111 or 1234)"
  }
  return null
}

/**
 * How a failed money request relates to the PIN step: no PIN set yet (403), a wrong PIN (400
 * naming the PIN) or locked out (423) keep the user on the PIN step; anything else (e.g.
 * insufficient funds) belongs back on the details step.
 */
export function pinErrorKind(error: unknown): "not-set" | "pin" | "other" {
  if (!isApiError(error)) return "other"
  if (error.status === 403 && /PIN/i.test(error.message)) return "not-set"
  if (error.status === 423 || (error.status === 400 && /PIN/i.test(error.message))) return "pin"
  return "other"
}
