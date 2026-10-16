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
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
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
  // A form with files goes as multipart; the browser sets its Content-Type (with the boundary)
  const isForm = body instanceof FormData

  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      signal,
      headers: {
        ...(body !== undefined && !isForm && { "Content-Type": "application/json" }),
        ...(token && { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: isForm ? body : body !== undefined ? JSON.stringify(body) : undefined,
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

/**
 * Downloads a file endpoint (e.g. a statement) with the user's token and saves it under the
 * filename the server suggests. Errors come back as the usual JSON envelope.
 */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0)
  }

  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as Envelope<unknown> | null
    if (res.status === 401 && token) unauthorizedHandler?.()
    throw new ApiError(payload?.message ?? `Download failed (${res.status})`, res.status)
  }

  const filename = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? fallbackName
  const url = URL.createObjectURL(await res.blob())
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before releasing the blob
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/** Fetches a protected file (e.g. an ID photo for review) as a Blob, sending the user's token. */
export async function fetchBlob(path: string): Promise<Blob> {
  const token = getToken()
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" })
  } catch {
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0)
  }
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as Envelope<unknown> | null
    if (res.status === 401 && token) unauthorizedHandler?.()
    throw new ApiError(payload?.message ?? `Request failed (${res.status})`, res.status)
  }
  return res.blob()
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Something went wrong"
}
