// The JWT is kept in localStorage so a refresh doesn't log the user out.
// Every access is wrapped because storage can throw (private mode, blocked site data).
const TOKEN_KEY = "wallet.token"

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

export function setToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {
    // Session still works for this tab; it just won't survive a reload
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {
    // Nothing to clear
  }
}

export { TOKEN_KEY }
