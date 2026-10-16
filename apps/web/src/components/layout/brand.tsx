import { WalletIcon } from "lucide-react"
import { Link } from "react-router"

// `compact` hides the wordmark on the slim tablet sidebar
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5" aria-label="PurpleWallet home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <WalletIcon className="size-4" aria-hidden />
      </span>
      {/* "Purple" in the brand violet, "Wallet" in the text colour (black, or white in dark mode) */}
      <span className={`font-brand text-2xl leading-none font-bold ${compact ? "hidden lg:inline" : ""}`}>
        <span className="text-primary">Purple</span>
        <span className="text-foreground">Wallet</span>
      </span>
    </Link>
  )
}
