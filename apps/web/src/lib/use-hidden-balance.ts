import { useCallback, useSyncExternalStore } from "react"

const KEY = "wallet.hideBalance"
const listeners = new Set<() => void>()

let hidden = (() => {
  try {
    return localStorage.getItem(KEY) === "1"
  } catch {
    return false
  }
})()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// The eye toggle on the balance card. Shared by every amount that respects it and
// remembered per browser.
export function useHiddenBalance() {
  const value = useSyncExternalStore(subscribe, () => hidden)

  const toggle = useCallback(() => {
    hidden = !hidden
    try {
      if (hidden) localStorage.setItem(KEY, "1")
      else localStorage.removeItem(KEY)
    } catch {
      // Still toggles for this visit
    }
    listeners.forEach((listener) => listener())
  }, [])

  return { hidden: value, toggle }
}
