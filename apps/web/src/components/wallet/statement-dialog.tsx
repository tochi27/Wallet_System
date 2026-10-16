import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { AlertCircleIcon, FileDownIcon, Loader2Icon } from "lucide-react"
import { toast } from "sonner"
import { statementPath } from "@/api/wallet"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { downloadFile, errorMessage } from "@/lib/api"
import { cn } from "@/lib/utils"

// Calendar dates in the viewer's timezone, as YYYY-MM-DD
const isoDay = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`

function presets(today = new Date()) {
  const y = today.getFullYear()
  const m = today.getMonth()
  return [
    { label: "This month", from: isoDay(new Date(y, m, 1)), to: isoDay(today) },
    { label: "Last month", from: isoDay(new Date(y, m - 1, 1)), to: isoDay(new Date(y, m, 0)) },
    { label: "Last 3 months", from: isoDay(new Date(y, m - 2, 1)), to: isoDay(today) },
  ]
}

export function StatementDialog() {
  const [open, setOpen] = useState(false)
  const [options] = useState(presets)
  const [from, setFrom] = useState(options[0].from)
  const [to, setTo] = useState(options[0].to)
  const [format, setFormat] = useState<"pdf" | "csv">("pdf")

  const download = useMutation({
    mutationFn: () => downloadFile(statementPath(from, to, format), `purplewallet-statement.${format}`),
    onSuccess: () => {
      toast.success("Statement downloaded")
      setOpen(false)
    },
  })

  const invalid = !from || !to || to < from

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) download.reset()
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="rounded-full bg-card shadow-soft">
          <FileDownIcon aria-hidden />
          Statement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (!invalid) download.mutate()
          }}
        >
          <DialogHeader>
            <DialogTitle>Download a statement</DialogTitle>
            <DialogDescription>Every completed transaction in the period, with running balances.</DialogDescription>
          </DialogHeader>

          <FieldGroup>
            {download.isError && (
              <Alert variant="destructive">
                <AlertCircleIcon aria-hidden />
                <AlertDescription>{errorMessage(download.error)}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-wrap gap-2" role="group" aria-label="Quick periods">
              {options.map((preset) => {
                const active = preset.from === from && preset.to === to
                return (
                  <button
                    key={preset.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setFrom(preset.from)
                      setTo(preset.to)
                    }}
                    className={cn(
                      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      active ? "border-primary bg-secondary text-secondary-foreground" : "hover:bg-muted"
                    )}
                  >
                    {preset.label}
                  </button>
                )
              })}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field>
                <FieldLabel htmlFor="statement-from">From</FieldLabel>
                <Input id="statement-from" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
              </Field>
              <Field data-invalid={invalid}>
                <FieldLabel htmlFor="statement-to">To</FieldLabel>
                <Input id="statement-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-invalid={invalid} />
              </Field>
            </div>
            <Field>
              <span className="text-sm font-medium" id="statement-format">
                Format
              </span>
              <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-labelledby="statement-format">
                {(["pdf", "csv"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={format === value}
                    onClick={() => setFormat(value)}
                    className={cn(
                      "rounded-xl border px-3 py-2.5 text-left text-sm transition-colors",
                      format === value ? "border-primary bg-secondary/60" : "hover:bg-muted"
                    )}
                  >
                    <span className="block font-medium">{value === "pdf" ? "PDF" : "CSV"}</span>
                    <span className="block text-xs text-muted-foreground">
                      {value === "pdf" ? "To read, print or share" : "For Excel or Sheets"}
                    </span>
                  </button>
                ))}
              </div>
            </Field>
          </FieldGroup>

          <DialogFooter>
            <Button type="submit" disabled={invalid || download.isPending}>
              {download.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Download
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
