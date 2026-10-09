import { createContext, useContext } from "react"

export type Theme = "light" | "dark" | "system"

export type ThemeContextValue = {
  theme: Theme
  resolvedTheme: "light" | "dark"
  setTheme: (theme: Theme) => void
}

// Must match the inline script in index.html, which applies the theme before React loads
export const THEME_KEY = "wallet.theme"

export const ThemeContext = createContext<ThemeContextValue | null>(null)

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>")
  return ctx
}
