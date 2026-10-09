import type { ComponentProps } from "react"
import { Controller, type Control, type FieldPath, type FieldValues } from "react-hook-form"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"

type TextFieldProps<T extends FieldValues> = {
  control: Control<T>
  name: FieldPath<T>
  label: string
  description?: string
} & Omit<ComponentProps<typeof Input>, "name" | "value" | "defaultValue" | "onChange" | "onBlur">

// Input + label + validation message wired to react-hook-form
export function TextField<T extends FieldValues>({
  control,
  name,
  label,
  description,
  id,
  ...inputProps
}: TextFieldProps<T>) {
  const inputId = id ?? name

  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={inputId}>{label}</FieldLabel>
          <Input {...inputProps} {...field} id={inputId} aria-invalid={fieldState.invalid} />
          {description && <FieldDescription>{description}</FieldDescription>}
          {fieldState.invalid && <FieldError errors={[fieldState.error]} />}
        </Field>
      )}
    />
  )
}
