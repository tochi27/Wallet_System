import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react"
import { useMutation } from "@tanstack/react-query"
import { ArrowUpIcon, Loader2Icon, RotateCcwIcon, SendIcon, SparklesIcon, ArrowUpRightIcon } from "lucide-react"
import { Link } from "react-router"
import { askAssistant, type AssistantAnswer, type ChatTurn } from "@/api/assistant"
import { InsightsOptIn } from "@/components/insights/insights-consent"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { AssistantContext } from "@/lib/assistant-context"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { CATEGORY_META } from "@/lib/categories"
import { useMoneyActions } from "@/lib/money-actions-context"
import { formatMoney, formatSignedMoney } from "@/lib/money"
import { cn } from "@/lib/utils"

type Message =
  | { role: "user"; text: string }
  | { role: "assistant"; text: string; answer?: AssistantAnswer; error?: boolean }

const SUGGESTIONS = [
  "How much did I spend on food this month?",
  "Who have I sent the most money to?",
  "What was my biggest payment this month?",
  "How do I change my PIN?",
]

// The conversation lives only in this browser tab: nothing is stored on the server
const STORAGE_KEY = "purplewallet.assistant"
const load = (): Message[] => {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "[]") as Message[]
  } catch {
    return []
  }
}
const save = (messages: Message[]) => {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(messages.slice(-30)))
  } catch {
    // Private mode or storage blocked: the chat still works, it just won't survive a reload
  }
}

const shortDate = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" })

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <AssistantContext.Provider value={() => setOpen(true)}>
      {children}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className={cn(
            // Phones: full screen. Larger screens: a panel in the bottom-right corner.
            "inset-0 top-0 left-0 flex h-svh max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0",
            "sm:inset-auto sm:top-auto sm:right-6 sm:bottom-6 sm:left-auto sm:h-[min(680px,calc(100svh-3rem))] sm:w-[420px] sm:max-w-[420px] sm:rounded-3xl"
          )}
        >
          {open && <AssistantChat onNavigate={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </AssistantContext.Provider>
  )
}

function AssistantChat({ onNavigate }: { onNavigate: () => void }) {
  const { user } = useAuth()
  const [messages, setMessages] = useState<Message[]>(load)
  const [draft, setDraft] = useState("")
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    save(messages)
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  const mutation = useMutation({
    mutationFn: ({ text, history }: { text: string; history: ChatTurn[] }) => askAssistant(text, history),
    onSuccess: (answer) => setMessages((m) => [...m, { role: "assistant", text: answer.answer, answer }]),
    onError: (error) => setMessages((m) => [...m, { role: "assistant", text: errorMessage(error), error: true }]),
  })

  const send = (text: string) => {
    const question = text.trim()
    if (!question || mutation.isPending) return
    // Only real exchanges go back as history, not error notices
    const history: ChatTurn[] = messages.filter((m) => !("error" in m && m.error)).map((m) => ({ role: m.role, text: m.text }))
    setMessages((m) => [...m, { role: "user", text: question }])
    setDraft("")
    mutation.mutate({ text: question, history })
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b px-4 py-3 pr-12">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-primary">
          <SparklesIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-base">Ask PurpleWallet</DialogTitle>
          <DialogDescription className="text-xs">Questions about your money and the app</DialogDescription>
        </div>
        {messages.length > 0 && (
          <Button variant="ghost" size="sm" className="rounded-full" onClick={() => setMessages([])}>
            <RotateCcwIcon aria-hidden />
            New chat
          </Button>
        )}
      </header>

      {!user?.aiInsightsEnabled ? (
        <div className="flex-1 overflow-y-auto p-5">
          <InsightsOptIn />
        </div>
      ) : (
        <>
          <div className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">
                  Ask about your spending, transfers and balance, or how something in the app works. I can't move money, but I
                  can set up a transfer for you to confirm.
                </p>
                <div className="flex flex-col items-start gap-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => send(s)}
                      className="rounded-full border px-3 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ol className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <li key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                    {m.role === "user" ? (
                      <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.text}</p>
                    ) : (
                      <AssistantMessage message={m} onNavigate={onNavigate} />
                    )}
                  </li>
                ))}
                {mutation.isPending && (
                  <li className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                    <Loader2Icon className="size-4 animate-spin" aria-hidden />
                    Looking that up…
                  </li>
                )}
              </ol>
            )}
            <div ref={endRef} />
          </div>

          <form onSubmit={onSubmit} className="border-t p-3">
            <div className="flex items-end gap-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault()
                    send(draft)
                  }
                }}
                rows={1}
                maxLength={500}
                placeholder="Ask about your money…"
                aria-label="Your question"
                className="max-h-32 min-h-10 flex-1 resize-none rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <Button type="submit" size="icon" className="size-10 shrink-0 rounded-full" disabled={!draft.trim() || mutation.isPending} aria-label="Send">
                <ArrowUpIcon aria-hidden />
              </Button>
            </div>
            <p className="mt-2 px-1 text-[11px] text-muted-foreground">AI can make mistakes. Check the transactions it shows you.</p>
          </form>
        </>
      )}
    </>
  )
}

function AssistantMessage({ message, onNavigate }: { message: Extract<Message, { role: "assistant" }>; onNavigate: () => void }) {
  const openAction = useMoneyActions()
  const answer = message.answer
  const action = answer?.action

  return (
    <div className={cn("flex max-w-[92%] flex-col gap-2 rounded-2xl rounded-bl-md px-3.5 py-2.5 text-sm", message.error ? "bg-destructive/10 text-destructive" : "bg-muted")}>
      <p className="whitespace-pre-wrap">{message.text}</p>

      {answer && answer.transactions.length > 0 && (
        <ul className="-mx-1 flex flex-col divide-y divide-border/70 rounded-xl bg-card px-1 ring-1 ring-border/70">
          {answer.transactions.map((tx) => (
            <li key={tx.id}>
              <Link to={`/transactions/${tx.id}`} onClick={onNavigate} className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/60">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{tx.description || tx.counterparty || "Transaction"}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {shortDate.format(new Date(tx.timestamp))}
                    {tx.counterparty ? ` · ${tx.counterparty}` : ""}
                    {tx.category ? ` · ${CATEGORY_META[tx.category].label}` : ""}
                  </span>
                </span>
                <span className="shrink-0 font-medium tabular-nums">{formatSignedMoney(tx.type === "CREDIT" ? tx.amount : -Number(tx.amount))}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {action && (
        <Button
          size="sm"
          className="self-start rounded-full"
          onClick={() => {
            onNavigate()
            if (action.type === "send_money") {
              openAction("transfer", { receiverEmail: action.recipientEmail ?? undefined, amount: action.amount ?? undefined })
            } else {
              openAction("debit", { amount: action.amount ?? undefined })
            }
          }}
        >
          {action.type === "send_money" ? <SendIcon aria-hidden /> : <ArrowUpRightIcon aria-hidden />}
          {action.type === "send_money"
            ? `Send${action.amount ? ` ${formatMoney(action.amount)}` : ""}${action.recipientName ? ` to ${action.recipientName.split(" ")[0]}` : ""}`
            : `Withdraw${action.amount ? ` ${formatMoney(action.amount)}` : ""}`}
        </Button>
      )}
      {action?.type === "send_money" && !action.recipientEmail && action.recipientName && (
        <p className="text-xs text-muted-foreground">You'll need to enter {action.recipientName.split(" ")[0]}'s email address.</p>
      )}
    </div>
  )
}
