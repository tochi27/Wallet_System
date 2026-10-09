import type { WalletStats } from "@/api/wallet"
import { Money } from "@/components/money"
import { Skeleton } from "@/components/ui/skeleton"
import { currencySymbol, toAmount } from "@/lib/money"
import { cn } from "@/lib/utils"

// "Your balance has grown by $X in the last N days" — the violet hero card
export function GrowthHero({ stats, className }: { stats: WalletStats | undefined; className?: string }) {
  const change = stats ? toAmount(stats.balance.change) : 0
  const heading =
    change > 0 ? "Your balance has grown by" : change < 0 ? "Your balance has dropped by" : "Your balance hasn't changed"

  return (
    <section
      className={cn(
        "hero-gradient relative isolate min-h-48 overflow-hidden rounded-3xl p-6 text-white shadow-soft sm:p-7 lg:p-8",
        className
      )}
      aria-label="Balance change"
    >
      <GrowthIllustration
        falling={change < 0}
        className="pointer-events-none absolute right-0 bottom-0 -z-10 h-auto w-1/2 max-w-80 opacity-90"
      />
      {stats ? (
        <div className="max-w-[60%]">
          <p className="text-lg leading-snug font-medium text-white/90 sm:text-xl">{heading}</p>
          {change !== 0 && (
            <p className="mt-2 text-4xl font-semibold tracking-tight">
              <Money value={Math.abs(change)} fractionClassName="font-normal text-white/70" />
            </p>
          )}
          <p className="mt-3 text-sm text-white/80">In the last {stats.days} days</p>
        </div>
      ) : (
        <div className="flex max-w-xs flex-col gap-3">
          <Skeleton className="h-6 w-56 bg-white/20" />
          <Skeleton className="h-10 w-36 bg-white/20" />
          <Skeleton className="h-4 w-28 bg-white/20" />
        </div>
      )}
    </section>
  )
}

function GrowthIllustration({ falling, className }: { falling: boolean; className?: string }) {
  // Bars rise left to right; flipped horizontally when the balance fell
  return (
    <svg viewBox="0 0 220 170" className={className} aria-hidden>
      <defs>
        <linearGradient id="hero-bar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.55" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="hero-coin" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#e7e1ff" stopOpacity="0.75" />
        </linearGradient>
        <radialGradient id="hero-glow" cx="0.65" cy="0.45" r="0.6">
          <stop offset="0" stopColor="#fff" stopOpacity="0.35" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="220" height="170" fill="url(#hero-glow)" />
      <g transform={falling ? "translate(220 0) scale(-1 1)" : undefined}>
        {[
          { x: 70, h: 40 },
          { x: 96, h: 62 },
          { x: 122, h: 54 },
          { x: 148, h: 88 },
          { x: 174, h: 118 },
        ].map((bar) => (
          <rect key={bar.x} x={bar.x} y={170 - bar.h} width="18" height={bar.h} rx="4" fill="url(#hero-bar)" />
        ))}
        <path
          d="M40 128 C 90 120, 120 96, 150 70 S 190 32, 200 22"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.9"
          strokeWidth="5"
          strokeLinecap="round"
        />
        <path d="M184 18 L206 16 L202 38 Z" fill="#fff" fillOpacity="0.95" />
        <circle cx="64" cy="58" r="2" fill="#fff" fillOpacity="0.8" />
        <circle cx="118" cy="30" r="1.5" fill="#fff" fillOpacity="0.7" />
      </g>
      <g transform="translate(118 112)">
        {[36, 24, 12, 0].map((y) => (
          <g key={y} transform={`translate(0 ${y})`}>
            <ellipse cx="22" cy="8" rx="22" ry="8" fill="#c9bcff" />
            <rect x="0" y="0" width="44" height="8" fill="#d9d0ff" />
            <ellipse cx="22" cy="0" rx="22" ry="8" fill="url(#hero-coin)" />
          </g>
        ))}
        <text x="22" y="4" textAnchor="middle" fontSize="10" fontWeight="700" fill="#6d4aff">
          {currencySymbol()}
        </text>
      </g>
    </svg>
  )
}
