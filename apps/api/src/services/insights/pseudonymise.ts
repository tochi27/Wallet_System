/**
 * Stands people in for "Person A", "Person B"… before anything is sent to the AI provider, and
 * swaps the real names back into its reply. Email addresses (e.g. in the default "Transfer to
 * ada@example.com" description) are replaced too, so the provider never learns who a user pays.
 */
export class Pseudonymiser {
  private readonly aliasByKey = new Map<string, string>();
  private readonly realByAlias = new Map<string, string>();

  private nextAlias(): string {
    const n = this.realByAlias.size;
    return n < 26 ? `Person ${String.fromCharCode(65 + n)}` : `Person ${n + 1}`;
  }

  /**
   * Same person, same alias. `keys` are everything that identifies them (user ID, full name,
   * email); any of them seen in text later is replaced by the one alias. `display` is what
   * replaces the alias in the reply (a first name).
   */
  alias(keys: string | string[], display: string): string {
    const normalised = (Array.isArray(keys) ? keys : [keys]).map((k) => k.trim().toLowerCase()).filter(Boolean);
    let alias = normalised.map((k) => this.aliasByKey.get(k)).find(Boolean);
    if (!alias) {
      alias = this.nextAlias();
      this.realByAlias.set(alias, display);
    }
    for (const key of normalised) this.aliasByKey.set(key, alias);
    return alias;
  }

  /** Free text with known names and any email addresses replaced. */
  scrub(text: string | null | undefined): string {
    if (!text) return "";
    let result = text.replace(/[^\s@]+@[^\s@]+\.[^\s@]+/g, (email) => this.aliasByKey.get(email.toLowerCase()) ?? "someone");
    // Longest names first, so "Ada Lovelace" is replaced before "Ada"
    const names = [...this.aliasByKey.keys()].filter((k) => !k.includes("@")).sort((a, b) => b.length - a.length);
    for (const name of names) {
      const pattern = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
      result = result.replace(pattern, this.aliasByKey.get(name)!);
    }
    return result;
  }

  /** Puts real (first) names back into text written by the AI. */
  restore(text: string): string {
    // "Person 27" before "Person 2", so a shorter alias never eats part of a longer one
    const aliases = [...this.realByAlias.keys()].sort((a, b) => b.length - a.length);
    return aliases.reduce((result, alias) => result.split(alias).join(this.realByAlias.get(alias)!), text);
  }
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;
