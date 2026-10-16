import { useState } from "react"
import { AlertCircleIcon, Loader2Icon } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Textarea } from "@/components/ui/textarea"

type ReasonDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  confirmLabel: string
  destructive?: boolean
  pending: boolean
  error: string | null
  onConfirm: (reason: string) => void
}

// Every admin action that changes a user needs a reason; it goes into the permanent audit log
export function ReasonDialog({ open, onOpenChange, title, description, confirmLabel, destructive, pending, error, onConfirm }: ReasonDialogProps) {
  const [reason, setReason] = useState("")
  const tooShort = reason.trim().length < 3

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("")
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!tooShort) onConfirm(reason.trim())
          }}
        >
          {error && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          <Field>
            <FieldLabel htmlFor="admin-reason">Reason</FieldLabel>
            <Textarea
              id="admin-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={500}
              rows={3}
              autoFocus
              placeholder="e.g. Customer confirmed identity by phone"
            />
            <FieldDescription>Recorded permanently in the audit log. The user doesn't see it.</FieldDescription>
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={tooShort || pending}>
              {pending && <Loader2Icon className="animate-spin" aria-hidden />}
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
