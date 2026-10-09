import { getToken } from "@/lib/token"

const API_URL = (import.meta.env.VITE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "")

// Every API response is wrapped as { success, message, data }
type Envelope<T> = {
  success: boolean
  message: string
  data?: T
}

export class ApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE"
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

let unauthorizedHandler: (() => void) | null = null

// The auth provider registers this so any 401 on an authenticated request ends the session
export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, headers, signal } = options
  const token = getToken()

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  } catch (err) {
    if (signal?.aborted) throw err
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0)
  }

  const payload = (await res.json().catch(() => null)) as Envelope<T> | null

  if (!res.ok || !payload?.success) {
    if (res.status === 401 && token) unauthorizedHandler?.()
    throw new ApiError(payload?.message ?? `Request failed (${res.status})`, res.status)
  }

  return payload.data as T
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong"
}
