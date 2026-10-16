import { useState } from "react"
import { Loader2Icon, ShieldCheckIcon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useInsightsToggle } from "@/lib/use-insights-toggle"

/** Explains exactly what's shared before anything is sent, then opts in. */
export function InsightsConsentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const toggle = useInsightsToggle()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SparklesIcon className="size-5 text-primary" aria-hidden />
            Turn on AI features?
          </DialogTitle>
          <DialogDescription>
            Get monthly spending insights, and an assistant you can ask about your money ("How much did I spend on food?").
            It can't move money: anything it sets up, you confirm with your PIN.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex flex-col gap-3 text-sm">
          <li className="flex gap-2.5">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">What's shared:</span> your payment descriptions, amounts and dates, and your
              questions to the assistant, are sent to Google's Gemini AI.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">What's never shared:</span> your name, email, account details, and who you pay.
              People are replaced with labels like "Person A".
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>
              <span className="font-medium">Every number is ours:</span> totals are calculated by PurpleWallet and checked
              before you see them.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
            <span>Assistant chats stay in your browser, not on our servers. Turn this off any time in Settings, which deletes your insights.</span>
          </li>
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button
            disabled={toggle.isPending}
            onClick={() => toggle.mutate(true, { onSuccess: () => onOpenChange(false) })}
          >
            {toggle.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
            Turn on
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** The pitch shown wherever insights would appear, until the user opts in. */
export function InsightsOptIn({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex flex-col items-start gap-3">
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <SparklesIcon className="size-5" aria-hidden />
      </span>
      <div>
        <p className="font-semibold">See where your money goes</p>
        <p className="mt-1 text-sm text-muted-foreground">
          {compact
            ? "Get a monthly summary of your spending, sorted into categories."
            : "Turn on AI features for a monthly summary of your spending, and an assistant you can ask about your money."}
        </p>
      </div>
      <Button className="rounded-full" onClick={() => setOpen(true)}>
        Turn on AI features
      </Button>
      <InsightsConsentDialog open={open} onOpenChange={setOpen} />
    </div>
  )
}
