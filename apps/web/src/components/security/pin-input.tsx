import { useState } from "react"
import { cn } from "@/lib/utils"

type PinInputProps = {
  id?: string
  label: string
  value: string
  onChange: (value: string) => void
  // Called once 4 digits are entered, e.g. to submit straight away
  onComplete?: (value: string) => void
  autoFocus?: boolean
  invalid?: boolean
  disabled?: boolean
}

/**
 * Four PIN boxes backed by a single real input, so typing, pasting, mobile number pads,
 * screen readers and password managers all behave normally.
 */
export function PinInput({ id, label, value, onChange, onComplete, autoFocus, invalid, disabled }: PinInputProps) {
  const [focused, setFocused] = useState(false)

  return (
    <div className="relative mx-auto w-fit">
      <input
        id={id}
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="off"
        maxLength={4}
        aria-label={label}
        aria-invalid={invalid}
        autoFocus={autoFocus}
        disabled={disabled}
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => {
          const digits = event.target.value.replace(/\D/g, "").slice(0, 4)
          onChange(digits)
          if (digits.length === 4) onComplete?.(digits)
        }}
        className="absolute inset-0 z-10 h-full w-full cursor-text opacity-0 disabled:cursor-not-allowed"
      />
      <div className="flex gap-3" aria-hidden>
        {[0, 1, 2, 3].map((index) => {
          const active = focused && index === Math.min(value.length, 3)
          return (
            <div
              key={index}
              className={cn(
                "flex size-12 items-center justify-center rounded-xl border-2 bg-card text-2xl transition-colors",
                invalid ? "border-destructive" : active ? "border-primary" : "border-input",
                disabled && "opacity-50"
              )}
            >
              {value[index] ? "•" : ""}
            </div>
          )
        })}
      </div>
    </div>
  )
}
