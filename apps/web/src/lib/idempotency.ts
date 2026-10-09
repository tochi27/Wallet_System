import { useCallback, useState } from "react"
import { isApiError } from "@/lib/api"

// One Idempotency-Key per money form. The API stores only successful responses
// under a key (for 24h), so:
// - a network failure keeps the key: the request may have gone through, and a
//   retry with the same key returns the original result instead of charging twice
// - a response from the server that rejected the request renews the key, so a
//   corrected retry isn't treated as a duplicate
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID())

  const renew = useCallback(() => setKey(crypto.randomUUID()), [])

  const renewIfRejected = useCallback((error: unknown) => {
    if (isApiError(error) && error.status > 0) setKey(crypto.randomUUID())
  }, [])

  return { key, renew, renewIfRejected }
}
