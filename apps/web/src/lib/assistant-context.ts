import { createContext, useContext } from "react"

export const AssistantContext = createContext<(() => void) | null>(null)

// Opens the "Ask PurpleWallet" panel from anywhere in the app shell
export function useOpenAssistant() {
  const open = useContext(AssistantContext)
  if (!open) throw new Error("useOpenAssistant must be used inside <AssistantProvider>")
  return open
}
