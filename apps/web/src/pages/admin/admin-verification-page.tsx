import { useEffect, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, ArrowLeftIcon, CheckIcon, ExternalLinkIcon, Loader2Icon, XIcon } from "lucide-react"
import { Link, useParams } from "react-router"
import { toast } from "sonner"
import { ID_TYPES, TIER_NAMES, type DocumentKind } from "@/api/account"
import {
  adminKeys,
  approveVerification,
  REJECTION_REASONS,
  rejectVerification,
  useVerification,
  verificationDocumentPath,
  verificationKey,
  type RejectionReason,
  type VerificationDetail,
} from "@/api/admin"
import { EmptyState, Panel, ToneBadge } from "@/components/admin/admin-ui"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime, tone, verificationLabel, verificationTone } from "@/lib/admin"
import { errorMessage, fetchBlob } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { can } from "@/lib/permissions"
import { cn } from "@/lib/utils"

const DOCUMENT_LABELS: Record<DocumentKind, string> = { ID_FRONT: "ID (front)", ID_BACK: "ID (back)", SELFIE: "Selfie with ID" }
const longDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" })

const ageOn = (dateOfBirth: string) => {
  const born = new Date(dateOfBirth)
  const now = new Date()
  let age = now.getUTCFullYear() - born.getUTCFullYear()
  if (now.getUTCMonth() < born.getUTCMonth() || (now.getUTCMonth() === born.getUTCMonth() && now.getUTCDate() < born.getUTCDate())) age--
  return age
}

export function AdminVerificationPage() {
  const { id = "" } = useParams()
  const { data, error } = useVerification(id)

  return (
    <div className="flex flex-col gap-5">
      <Link to="/admin/verifications" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden />
        All ID checks
      </Link>
      {error ? (
        <Panel>
          <EmptyState>{errorMessage(error)}</EmptyState>
        </Panel>
      ) : !data ? (
        <Skeleton className="h-96 w-full rounded-3xl" />
      ) : (
        <Review request={data} />
      )}
    </div>
  )
}

function Review({ request }: { request: VerificationDetail }) {
  const { user: me } = useAuth()
  const queryClient = useQueryClient()
  const [rejecting, setRejecting] = useState(false)
  const own = request.user.id === me?.id
  const canDecide = can(me?.role, "kyc.review") && request.status === "PENDING" && !own
  const nameMatches = request.legalName.trim().toLowerCase() === request.user.name.trim().toLowerCase()

  const done = (updated: VerificationDetail, message: string) => {
    queryClient.setQueryData(verificationKey(request.id), updated)
    void queryClient.invalidateQueries({ queryKey: adminKeys.all, predicate: (q) => q.queryKey[1] !== "verification" })
    toast.success(message)
  }
  const approve = useMutation({
    mutationFn: () => approveVerification(request.id),
    onSuccess: (updated) => done(updated, `Approved. ${request.user.name} is now on Tier 2.`),
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <>
      <Panel>
        <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{request.user.name}</h2>
              <ToneBadge className={verificationTone[request.status]}>{verificationLabel[request.status]}</ToneBadge>
              <ToneBadge className={tone.quiet}>Now {TIER_NAMES[request.user.tier]}</ToneBadge>
            </div>
            <p className="text-sm text-muted-foreground">
              {request.user.email} ·{" "}
              <Link to={`/admin/users/${request.user.id}`} className="underline underline-offset-4">
                Open account
              </Link>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Sent {formatDateTime(request.createdAt)}
              {request.reviewedAt && ` · reviewed ${formatDateTime(request.reviewedAt)}${request.reviewedBy ? ` by ${request.reviewedBy.name}` : ""}`}
            </p>
          </div>
          {canDecide && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" className="rounded-full" onClick={() => setRejecting(true)} disabled={approve.isPending}>
                <XIcon aria-hidden />
                Reject
              </Button>
              <Button className="rounded-full" onClick={() => approve.mutate()} disabled={approve.isPending}>
                {approve.isPending ? <Loader2Icon className="animate-spin" aria-hidden /> : <CheckIcon aria-hidden />}
                Approve
              </Button>
            </div>
          )}
        </div>
        {own && request.status === "PENDING" && (
          <p className="border-t border-border/70 px-5 py-3 text-sm text-muted-foreground">This is your own ID check, so another member of staff must review it.</p>
        )}
        {request.status === "REJECTED" && request.rejectionLabel && (
          <p className="border-t border-border/70 px-5 py-3 text-sm">
            <span className="font-medium">Rejected: {request.rejectionLabel}.</span>{" "}
            <span className="text-muted-foreground">{request.reviewMessage}</span>
          </p>
        )}
      </Panel>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Panel title="What they told us">
          <dl className="divide-y divide-border/70 text-sm">
            <Detail label="Name on ID">
              {request.legalName}
              <span className={cn("mt-1 block text-xs", nameMatches ? "text-muted-foreground" : "font-medium text-amber-700 dark:text-amber-400")}>
                {nameMatches ? "Same as the account name" : `Account name is “${request.user.name}”: check they're the same person`}
              </span>
            </Detail>
            <Detail label="Date of birth">
              {longDate.format(new Date(request.dateOfBirth))}
              <span className="mt-1 block text-xs text-muted-foreground">Age {ageOn(request.dateOfBirth)}</span>
            </Detail>
            <Detail label="ID type">{ID_TYPES[request.idType].label}</Detail>
            <Detail label={ID_TYPES[request.idType].numberLabel}>
              <span className="font-mono">{request.idNumber}</span>
            </Detail>
            <Detail label="Account">
              Joined {formatDateTime(request.user.createdAt)}
              <span className="mt-1 block text-xs text-muted-foreground">
                {request.user.emailVerifiedAt ? "Email verified" : "Email not verified"}
              </span>
            </Detail>
            {request.history.length > 0 && (
              <Detail label="Earlier checks">
                <ul className="flex flex-col gap-1">
                  {request.history.map((h) => (
                    <li key={h.id}>
                      <Link to={`/admin/verifications/${h.id}`} className="underline underline-offset-4">
                        {verificationLabel[h.status]}
                      </Link>{" "}
                      <span className="text-muted-foreground">{formatDateTime(h.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              </Detail>
            )}
          </dl>
        </Panel>

        <Panel title="Photos">
          {request.documentsDeletedAt ? (
            <EmptyState>The photos were deleted on {formatDateTime(request.documentsDeletedAt)}, 30 days after this check was rejected.</EmptyState>
          ) : (
            <div className="grid gap-4 p-5 sm:grid-cols-2">
              {request.documents.map((doc) => (
                <DocumentView key={doc.id} requestId={request.id} document={doc} />
              ))}
            </div>
          )}
        </Panel>
      </div>

      <RejectDialog
        open={rejecting}
        onOpenChange={setRejecting}
        name={request.user.name}
        requestId={request.id}
        onDone={(updated) => {
          done(updated, "Rejected. They've been told why and can try again.")
          setRejecting(false)
        }}
      />
    </>
  )
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:gap-4">
      <dt className="text-muted-foreground sm:w-32 sm:shrink-0">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

// ID photos need the reviewer's token, so they're fetched and shown from memory; nothing is cached
function DocumentView({ requestId, document }: { requestId: string; document: VerificationDetail["documents"][number] }) {
  const [url, setUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let objectUrl: string | null = null
    let cancelled = false
    fetchBlob(verificationDocumentPath(requestId, document.id))
      .then((blob) => {
        if (cancelled) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [requestId, document.id])

  const label = DOCUMENT_LABELS[document.kind]
  return (
    <figure className="flex flex-col gap-2">
      <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-2xl bg-muted">
        {error ? (
          <p className="p-4 text-center text-sm text-destructive">{error}</p>
        ) : !url ? (
          <Skeleton className="size-full" />
        ) : document.mimeType === "application/pdf" ? (
          <iframe src={url} title={label} className="size-full" />
        ) : (
          <img src={url} alt={label} className="size-full object-contain" />
        )}
      </div>
      <figcaption className="flex items-center justify-between text-sm">
        <span className="font-medium">{label}</span>
        {url && (
          <a href={url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Full size
            <ExternalLinkIcon className="size-3" aria-hidden />
          </a>
        )}
      </figcaption>
    </figure>
  )
}

function RejectDialog({
  open,
  onOpenChange,
  name,
  requestId,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  requestId: string
  onDone: (updated: VerificationDetail) => void
}) {
  const [reason, setReason] = useState<RejectionReason | null>(null)
  const [message, setMessage] = useState("")
  const needsMessage = reason === "OTHER" && message.trim().length < 3
  const mutation = useMutation({
    mutationFn: () => rejectVerification(requestId, reason!, message.trim() || undefined),
    onSuccess: onDone,
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setReason(null)
          setMessage("")
          mutation.reset()
        }
        onOpenChange(next)
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Reject this ID check?</DialogTitle>
          <DialogDescription>{name} will be told why and can send their ID again.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (reason && !needsMessage) mutation.mutate()
          }}
        >
          <Field>
            <FieldLabel id="reject-reason">Reason</FieldLabel>
            <div role="radiogroup" aria-labelledby="reject-reason" className="flex flex-col gap-1.5">
              {(Object.keys(REJECTION_REASONS) as RejectionReason[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  role="radio"
                  aria-checked={reason === key}
                  onClick={() => setReason(key)}
                  className={cn(
                    "flex items-center justify-between rounded-xl border px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    reason === key ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50"
                  )}
                >
                  {REJECTION_REASONS[key]}
                  {reason === key && <CheckIcon className="size-4 text-primary" aria-hidden />}
                </button>
              ))}
            </div>
          </Field>
          <Field>
            <FieldLabel htmlFor="reject-message">Message to {name.split(/\s+/)[0]} {reason === "OTHER" ? "" : "(optional)"}</FieldLabel>
            <Textarea
              id="reject-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              maxLength={300}
              placeholder="e.g. The bottom of the card is cut off. Take the photo with the whole card in view."
            />
            <FieldDescription>They'll see this, so keep it helpful. Don't include anything internal.</FieldDescription>
          </Field>
          {mutation.isError && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>{errorMessage(mutation.error)}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!reason || needsMessage || mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              Reject
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
