import { useEffect, useId, useMemo, useState, type ReactNode } from "react"
import { CameraIcon, FileTextIcon, RefreshCwIcon } from "lucide-react"
import { ACCEPTED_TYPES, MAX_FILE_BYTES } from "@/schemas/upgrade"
import { cn } from "@/lib/utils"

type DocumentPickerProps = {
  label: string
  hint: ReactNode
  file: File | null
  onChange: (file: File | null) => void
  // The selfie must be a photo; ID documents may also be a PDF
  allowPdf?: boolean
}

/**
 * Picks one photo (or PDF) and shows a preview. On phones the browser offers the camera or the
 * photo library. Size and type are checked here for a quick answer; the API checks them again.
 */
export function DocumentPicker({ label, hint, file, onChange, allowPdf = true }: DocumentPickerProps) {
  const id = useId()
  const [error, setError] = useState<string | null>(null)
  const accept = allowPdf ? ACCEPTED_TYPES : ACCEPTED_TYPES.filter((type) => type.startsWith("image/"))

  const preview = useMemo(() => (file?.type.startsWith("image/") ? URL.createObjectURL(file) : null), [file])
  // The preview URL is released when the file changes or the picker goes away
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  const pick = (chosen: File | undefined) => {
    if (!chosen) return
    if (!accept.includes(chosen.type)) {
      setError(allowPdf ? "Choose a JPEG or PNG photo, or a PDF." : "Choose a JPEG or PNG photo.")
      return
    }
    if (chosen.size > MAX_FILE_BYTES) {
      setError("That file is over 5 MB. Choose a smaller one.")
      return
    }
    setError(null)
    onChange(chosen)
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium" id={`${id}-label`}>
        {label}
      </span>
      <label
        htmlFor={id}
        className={cn(
          "flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed p-4 text-center text-sm transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted/50",
          error ? "border-destructive/50" : file ? "border-primary/40 bg-primary/5" : "border-border"
        )}
      >
        {preview ? (
          <img src={preview} alt={`Preview: ${label}`} className="max-h-56 rounded-lg object-contain" />
        ) : file ? (
          <>
            <FileTextIcon className="size-8 text-primary" aria-hidden />
            <span className="max-w-full truncate font-medium">{file.name}</span>
          </>
        ) : (
          <>
            <CameraIcon className="size-8 text-muted-foreground" aria-hidden />
            <span className="font-medium">Take a photo or choose a file</span>
            <span className="text-xs text-muted-foreground">{allowPdf ? "JPEG, PNG or PDF" : "JPEG or PNG"}, up to 5 MB</span>
          </>
        )}
        {file && (
          <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
            <RefreshCwIcon className="size-3.5" aria-hidden />
            Change
          </span>
        )}
        <input
          id={id}
          type="file"
          accept={accept.join(",")}
          className="sr-only"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-hint`}
          onChange={(event) => {
            pick(event.target.files?.[0])
            event.target.value = "" // lets the same file be picked again after an error
          }}
        />
      </label>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  )
}
