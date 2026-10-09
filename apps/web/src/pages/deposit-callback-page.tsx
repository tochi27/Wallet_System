import { useEffect, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { CheckCircle2Icon, Clock3Icon, Loader2Icon, XCircleIcon } from "lucide-react"
import { Link, useSearchParams } from "react-router"
import { useDepositStatus } from "@/api/payments"
import { walletKeys } from "@/api/wallet"
import { Money } from "@/components/money"
import { Button } from "@/components/ui/button"
import { errorMessage } from "@/lib/api"
import { useMoneyActions } from "@/lib/money-actions-context"
import { cn } from "@/lib/utils"

// How long to keep asking before telling the user we're still waiting on Paystack
const CONFIRM_WINDOW_MS = 60_000

// Paystack redirects here after checkout with ?reference=…&trxref=… (the same value)
export function DepositCallbackPage() {
  const [params] = useSearchParams()
  const reference = params.get("reference") ?? params.get("trxref")
  const queryClient = useQueryClient()
  const openAction = useMoneyActions()

  const [timedOut, setTimedOut] = useState(false)
  const [attempt, setAttempt] = useState(0)
  // Restarts whenever the user asks to check again
  useEffect(() => {
    const timer = setTimeout(() => setTimedOut(true), CONFIRM_WINDOW_MS)
    return () => clearTimeout(timer)
  }, [attempt])

  const { data: deposit, isError, error, refetch } = useDepositStatus(reference, !timedOut)

  // Once the deposit settles, refresh the balance and history everywhere
  const settled = deposit?.status === "SUCCESSFUL"
  useEffect(() => {
    if (settled) void queryClient.invalidateQueries({ queryKey: walletKeys.all })
  }, [settled, queryClient])

  const walletLink = (
    <Button asChild variant={settled ? "default" : "outline"} className="rounded-full">
      <Link to="/wallet">Go to wallet</Link>
    </Button>
  )

  if (!reference) {
    return (
      <Outcome tone="bad" icon={XCircleIcon} title="No payment to check">
        <p>This page is for returning from Paystack, but no payment reference came with it.</p>
        <Actions>{walletLink}</Actions>
      </Outcome>
    )
  }

  if (isError) {
    return (
      <Outcome tone="bad" icon={XCircleIcon} title="Couldn't check this payment">
        <p>{errorMessage(error)}</p>
        <Actions>
          <Button className="rounded-full" onClick={() => void refetch()}>
            Try again
          </Button>
          {walletLink}
        </Actions>
      </Outcome>
    )
  }

  if (!deposit || deposit.status === "PENDING") {
    if (!timedOut) {
      return (
        <Outcome tone="busy" icon={Loader2Icon} title="Confirming your payment…">
          <p>We're checking with Paystack. This usually takes a few seconds.</p>
        </Outcome>
      )
    }
    return (
      <Outcome tone="wait" icon={Clock3Icon} title="Still waiting for Paystack">
        <p>
          Your payment hasn't been confirmed yet. If you completed it, your wallet will update automatically once
          Paystack confirms it, so there's no need to pay again.
        </p>
        <Actions>
          <Button
            className="rounded-full"
            onClick={() => {
              setTimedOut(false)
              setAttempt((n) => n + 1)
            }}
          >
            Check again
          </Button>
          {walletLink}
        </Actions>
      </Outcome>
    )
  }

  if (deposit.status === "SUCCESSFUL") {
    return (
      <Outcome tone="good" icon={CheckCircle2Icon} title="Money added">
        <p className="text-3xl font-semibold tracking-tight text-foreground">
          <Money value={deposit.amount} />
        </p>
        <p>
          is now in your wallet{deposit.channel ? `, paid by ${deposit.channel.replace(/_/g, " ")}` : ""}.
        </p>
        <Actions>
          {walletLink}
          <Button variant="outline" className="rounded-full" onClick={() => openAction("credit")}>
            Add more
          </Button>
        </Actions>
      </Outcome>
    )
  }

  return (
    <Outcome tone="bad" icon={XCircleIcon} title="Payment not completed">
      <p>
        {deposit.failureReason ? `Paystack said: ${deposit.failureReason}. ` : ""}
        Your wallet wasn't credited.
      </p>
      <Actions>
        <Button className="rounded-full" onClick={() => openAction("credit")}>
          Try again
        </Button>
        {walletLink}
      </Actions>
    </Outcome>
  )
}

const TONES = {
  good: "bg-success/12 text-success",
  bad: "bg-destructive/10 text-destructive",
  wait: "bg-secondary text-primary",
  busy: "bg-secondary text-primary",
}

type OutcomeProps = {
  tone: keyof typeof TONES
  icon: typeof CheckCircle2Icon
  title: string
  children: ReactNode
}

function Outcome({ tone, icon: Icon, title, children }: OutcomeProps) {
  return (
    <div className="flex justify-center py-6 md:py-16">
      <section
        className="flex w-full max-w-md flex-col items-center gap-3 rounded-3xl bg-card p-8 text-center shadow-soft ring-1 ring-border/70"
        aria-live="polite"
      >
        <span className={cn("flex size-14 items-center justify-center rounded-full", TONES[tone])} aria-hidden>
          <Icon className={cn("size-7", tone === "busy" && "animate-spin")} />
        </span>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <div className="flex flex-col items-center gap-1 text-sm text-muted-foreground">{children}</div>
      </section>
    </div>
  )
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap justify-center gap-2">{children}</div>
}
