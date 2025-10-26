const blacklistedTokens = new Set<string>();

// Add token to blacklist
export const addToBlacklist = (token: string) => {
  blacklistedTokens.add(token);
};

// Check if token is blacklisted
export const isBlacklisted = (token: string): boolean => {
  return blacklistedTokens.has(token);
};

// Optional: clean up expired tokens automatically
export const addToBlacklistWithExpiry = (token: string, expiresIn: number) => {
  blacklistedTokens.add(token);
  setTimeout(() => blacklistedTokens.delete(token), expiresIn * 1000); // expiresIn in seconds
};
