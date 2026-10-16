import { useState } from "react"
import { zodResolver } from "@hookform/resolvers/zod"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AlertCircleIcon, ArrowLeftIcon, CheckIcon, ClockIcon, Loader2Icon, LockIcon, ShieldCheckIcon } from "lucide-react"
import { Controller, useForm, useWatch } from "react-hook-form"
import { Link, useNavigate } from "react-router"
import { toast } from "sonner"
import {
  ID_TYPES,
  limitsKeys,
  submitUpgrade,
  upgradeKeys,
  useUpgradeStatus,
  type DocumentKind,
  type IdType,
} from "@/api/account"
import { TextField } from "@/components/form/text-field"
import { DocumentPicker } from "@/components/limits/document-picker"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { errorMessage } from "@/lib/api"
import { useAuth } from "@/lib/auth-context"
import { cn } from "@/lib/utils"
import { upgradeDetailsSchema, type UpgradeDetailsValues } from "@/schemas/upgrade"

const STEPS = ["Your details", "Photo of your ID", "Selfie"] as const

export function UpgradePage() {
  const { data: status, isPending, error } = useUpgradeStatus()

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6">
      <Link to="/settings" className="flex w-fit items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" aria-hidden />
        Settings
      </Link>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Upgrade to Tier 2</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Send up to ₦500,000 at a time and ₦2,000,000 a day, with no limit on your balance. We just need to check your ID.
        </p>
      </div>

      {isPending ? (
        <Skeleton className="h-64 w-full rounded-3xl" />
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircleIcon aria-hidden />
          <AlertDescription>{errorMessage(error)}</AlertDescription>
        </Alert>
      ) : status.tier === "TIER_2" ? (
        <StatusCard icon={<CheckIcon className="size-5" aria-hidden />} title="You're already on Tier 2">
          Your ID has been checked and the higher limits apply.
        </StatusCard>
      ) : status.latest?.status === "PENDING" ? (
        <StatusCard icon={<ClockIcon className="size-5" aria-hidden />} title="We're checking your ID">
          You sent it on {new Date(status.latest.submittedAt).toLocaleDateString(undefined, { dateStyle: "long" })}. It
          usually takes up to 1 business day, and we'll let you know as soon as it's done.
        </StatusCard>
      ) : !status.canApply ? (
        <StatusCard icon={<AlertCircleIcon className="size-5" aria-hidden />} title="Verify your email first">
          Follow the link we emailed you, then come back here to upgrade.
        </StatusCard>
      ) : (
        <>
          {status.latest?.status === "REJECTED" && status.latest.rejection && (
            <Alert variant="destructive">
              <AlertCircleIcon aria-hidden />
              <AlertDescription>
                <span className="font-medium text-foreground">Last time we couldn't verify your ID: {status.latest.rejection.label}.</span>{" "}
                {status.latest.rejection.message}
              </AlertDescription>
            </Alert>
          )}
          <UpgradeForm />
        </>
      )}
    </div>
  )
}

function StatusCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 rounded-3xl bg-card p-5 shadow-soft ring-1 ring-border/70">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">{icon}</span>
      <div className="text-sm">
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-muted-foreground">{children}</p>
        <Button asChild variant="outline" className="mt-4 rounded-full">
          <Link to="/settings">Back to settings</Link>
        </Button>
      </div>
    </div>
  )
}

function UpgradeForm() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [files, setFiles] = useState<Partial<Record<DocumentKind, File>>>({})
  const [consent, setConsent] = useState(false)
  const [missing, setMissing] = useState<string | null>(null)

  const form = useForm<UpgradeDetailsValues>({
    resolver: zodResolver(upgradeDetailsSchema),
    defaultValues: { legalName: user?.name ?? "", dateOfBirth: "", idType: "NIN_SLIP", idNumber: "" },
  })
  const idType = useWatch({ control: form.control, name: "idType" })
  const idInfo = ID_TYPES[idType]

  const setFile = (kind: DocumentKind) => (file: File | null) => {
    setMissing(null)
    setFiles((current) => ({ ...current, [kind]: file ?? undefined }))
  }

  const mutation = useMutation({
    mutationFn: submitUpgrade,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: upgradeKeys.status }),
        queryClient.invalidateQueries({ queryKey: limitsKeys.all }),
      ])
      toast.success("Thanks! We're checking your ID.", { description: "It usually takes up to 1 business day." })
      navigate("/settings", { replace: true })
    },
  })

  const next = async () => {
    if (step === 0) {
      if (await form.trigger()) setStep(1)
      return
    }
    if (step === 1) {
      if (!files.ID_FRONT) return setMissing("Add a photo of your ID")
      if (idInfo.needsBack && !files.ID_BACK) return setMissing("Add a photo of the back too")
      setStep(2)
      return
    }
    if (!files.SELFIE) return setMissing("Add a selfie of you holding your ID")
    if (!consent) return setMissing("Tick the box to agree before sending")
    const details = form.getValues()
    // A back photo left over from a card type that's since changed isn't sent
    const chosen = { ID_FRONT: files.ID_FRONT, SELFIE: files.SELFIE, ...(idInfo.needsBack && { ID_BACK: files.ID_BACK }) }
    mutation.mutate({ ...details, files: chosen })
  }

  return (
    <div className="rounded-3xl bg-card shadow-soft ring-1 ring-border/70">
      <ol className="flex border-b border-border/70 text-xs sm:text-sm" aria-label="Steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            aria-current={index === step ? "step" : undefined}
            className={cn(
              "flex flex-1 items-center justify-center gap-2 px-2 py-3 text-center",
              index === step ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            <span
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs",
                index < step ? "bg-primary text-primary-foreground" : index === step ? "bg-primary/15 text-primary" : "bg-muted"
              )}
            >
              {index < step ? <CheckIcon className="size-3.5" aria-label="Done" /> : index + 1}
            </span>
            <span className="hidden sm:inline">{label}</span>
          </li>
        ))}
      </ol>

      <form
        className="flex flex-col gap-6 p-5 sm:p-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          void next()
        }}
      >
        <h2 className="text-base font-semibold sm:hidden">{STEPS[step]}</h2>

        {step === 0 && (
          <>
            <TextField
              control={form.control}
              name="legalName"
              label="Full name"
              description="Exactly as it appears on your ID."
              autoComplete="name"
            />
            <TextField control={form.control} name="dateOfBirth" label="Date of birth" type="date" autoComplete="bday" />
            <Controller
              control={form.control}
              name="idType"
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel id="id-type-label">Type of ID</FieldLabel>
                  <div role="radiogroup" aria-labelledby="id-type-label" className="grid gap-2 sm:grid-cols-2">
                    {(Object.keys(ID_TYPES) as IdType[]).map((type) => (
                      <button
                        key={type}
                        type="button"
                        role="radio"
                        aria-checked={field.value === type}
                        onClick={() => field.onChange(type)}
                        className={cn(
                          "flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          field.value === type ? "border-primary bg-primary/5 font-medium" : "hover:bg-muted/50"
                        )}
                      >
                        {ID_TYPES[type].label}
                        {field.value === type && <CheckIcon className="size-4 text-primary" aria-hidden />}
                      </button>
                    ))}
                  </div>
                  {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
                </Field>
              )}
            />
            <TextField
              control={form.control}
              name="idNumber"
              label={idInfo.numberLabel}
              description={idInfo.numberHint}
              autoComplete="off"
              inputMode={idType === "NIN_SLIP" || idType === "NATIONAL_ID" ? "numeric" : "text"}
            />
          </>
        )}

        {step === 1 && (
          <div className={cn("grid gap-5", idInfo.needsBack && "sm:grid-cols-2")}>
            <DocumentPicker
              label={idInfo.needsBack ? `Front of your ${idInfo.noun}` : `Your ${idInfo.noun}`}
              hint="Lay it flat in good light. All four corners and every word should be clear, with no glare."
              file={files.ID_FRONT ?? null}
              onChange={setFile("ID_FRONT")}
            />
            {idInfo.needsBack && (
              <DocumentPicker
                label={`Back of your ${idInfo.noun}`}
                hint="The same way: flat, in good light, all corners showing."
                file={files.ID_BACK ?? null}
                onChange={setFile("ID_BACK")}
              />
            )}
          </div>
        )}

        {step === 2 && (
          <>
            <DocumentPicker
              label="A selfie holding your ID"
              hint="Hold your ID next to your face. Your face and the ID's photo should both be clear. No hat or sunglasses."
              file={files.SELFIE ?? null}
              onChange={setFile("SELFIE")}
              allowPdf={false}
            />
            <label className="flex gap-3 rounded-2xl bg-muted/40 p-4 text-sm">
              <input
                type="checkbox"
                className="mt-0.5 size-4 shrink-0 accent-primary"
                checked={consent}
                onChange={(event) => {
                  setMissing(null)
                  setConsent(event.target.checked)
                }}
              />
              <span className="text-muted-foreground">
                I agree that PurpleWallet may use my ID and selfie to confirm who I am. They're stored encrypted, seen only
                by our review team and never shared or used for anything else. If my ID can't be accepted, the photos are
                deleted after 30 days.
              </span>
            </label>
          </>
        )}

        {(missing || mutation.isError) && (
          <Alert variant="destructive">
            <AlertCircleIcon aria-hidden />
            <AlertDescription>{missing ?? errorMessage(mutation.error)}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <LockIcon className="size-3.5 shrink-0" aria-hidden />
            Encrypted and only seen by our review team
          </p>
          <div className="flex gap-2">
            {step > 0 && (
              <Button type="button" variant="outline" className="flex-1 rounded-full sm:flex-none" onClick={() => setStep(step - 1)} disabled={mutation.isPending}>
                Back
              </Button>
            )}
            <Button type="submit" className="flex-1 rounded-full sm:flex-none" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2Icon className="animate-spin" aria-hidden />}
              {step < 2 ? "Continue" : (
                <>
                  {!mutation.isPending && <ShieldCheckIcon aria-hidden />}
                  Send for review
                </>
              )}
            </Button>
          </div>
        </div>
      </form>
    </div>
  )
}
