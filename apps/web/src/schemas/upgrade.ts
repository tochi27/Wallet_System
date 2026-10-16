import { z } from "zod"

// Mirrors apps/api/src/validators/kyc.validators.ts
const normalise = (value: string) => value.replace(/[\s-]/g, "").toUpperCase()

const ID_NUMBER_RULES = {
  NIN_SLIP: { pattern: /^\d{11}$/, message: "Your NIN is 11 digits" },
  NATIONAL_ID: { pattern: /^\d{11}$/, message: "Your NIN is 11 digits" },
  DRIVERS_LICENCE: { pattern: /^[A-Z0-9]{8,20}$/, message: "Enter the licence number exactly as it's printed" },
  PASSPORT: { pattern: /^[A-Z]\d{8}$/, message: "A Nigerian passport number is a letter and 8 digits, e.g. A12345678" },
  VOTERS_CARD: { pattern: /^[A-Z0-9]{19}$/, message: "Your voter identification number (VIN) is 19 characters" },
} as const

const isAdult = (value: string) => {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year + 18, month - 1, day)) <= new Date()
}

export const upgradeDetailsSchema = z
  .object({
    legalName: z.string().trim().min(3, "Enter your full name as it appears on your ID").max(100, "Keep your name under 100 characters"),
    dateOfBirth: z.iso
      .date("Enter your date of birth")
      .refine((value) => Number(value.slice(0, 4)) >= 1900, "Check your date of birth")
      .refine(isAdult, "You must be at least 18 to upgrade"),
    idType: z.enum(["NIN_SLIP", "NATIONAL_ID", "DRIVERS_LICENCE", "PASSPORT", "VOTERS_CARD"], { error: "Choose the type of ID" }),
    idNumber: z.string().min(1, "Enter your ID number"),
  })
  .superRefine((value, ctx) => {
    const rule = ID_NUMBER_RULES[value.idType]
    if (!rule.pattern.test(normalise(value.idNumber))) ctx.addIssue({ code: "custom", path: ["idNumber"], message: rule.message })
  })

export type UpgradeDetailsValues = z.infer<typeof upgradeDetailsSchema>

export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const ACCEPTED_TYPES = ["image/jpeg", "image/png", "application/pdf"]
