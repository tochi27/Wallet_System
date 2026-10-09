import { WalletIcon } from "lucide-react"
import { Link } from "react-router"

// `compact` hides the wordmark on the slim tablet sidebar
export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 font-semibold" aria-label="Wallet home">
      <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
        <WalletIcon className="size-4" aria-hidden />
      </span>
      <span className={compact ? "hidden lg:inline" : undefined}>Wallet</span>
    </Link>
  )
}
