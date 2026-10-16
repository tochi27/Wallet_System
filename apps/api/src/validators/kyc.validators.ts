import { KycIdType, UpgradeRejectionReason, UpgradeStatus } from "@prisma/client";
import { z } from "zod";

// Spaces and dashes are common when copying an ID number; letters are compared in capitals
const normalise = (value: string) => value.replace(/[\s-]/g, "").toUpperCase();

const ID_NUMBER_RULES: Record<KycIdType, { pattern: RegExp; message: string }> = {
  NIN_SLIP: { pattern: /^\d{11}$/, message: "Your NIN is 11 digits" },
  NATIONAL_ID: { pattern: /^\d{11}$/, message: "Your NIN is 11 digits" },
  DRIVERS_LICENCE: { pattern: /^[A-Z0-9]{8,20}$/, message: "Enter the licence number exactly as it's printed" },
  PASSPORT: { pattern: /^[A-Z]\d{8}$/, message: "A Nigerian passport number is a letter and 8 digits, e.g. A12345678" },
  VOTERS_CARD: { pattern: /^[A-Z0-9]{19}$/, message: "Your voter identification number (VIN) is 19 characters" },
};

const MIN_AGE = 18;

const isAdult = (date: Date) => {
  const now = new Date();
  const eighteenth = new Date(Date.UTC(date.getUTCFullYear() + MIN_AGE, date.getUTCMonth(), date.getUTCDate()));
  return eighteenth <= now;
};

// Multipart fields arrive as strings; the files are handled by the upload middleware
export const upgradeSchema = z
  .object({
    legalName: z
      .string({ error: "Enter your full name as it appears on your ID" })
      .trim()
      .min(3, "Enter your full name as it appears on your ID")
      .max(100, "Keep your name under 100 characters"),
    dateOfBirth: z.iso
      .date({ error: "Enter your date of birth" })
      .transform((value) => new Date(`${value}T00:00:00Z`))
      .refine((date) => date.getUTCFullYear() >= 1900, "Check your date of birth")
      .refine(isAdult, `You must be at least ${MIN_AGE} to upgrade`),
    idType: z.enum(KycIdType, { error: "Choose the type of ID" }),
    idNumber: z.string({ error: "Enter your ID number" }).transform(normalise),
  })
  .superRefine((value, ctx) => {
    const rule = ID_NUMBER_RULES[value.idType];
    if (!rule.pattern.test(value.idNumber)) ctx.addIssue({ code: "custom", path: ["idNumber"], message: rule.message });
  });

export const upgradeListQuerySchema = z.object({
  status: z.enum(UpgradeStatus).default(UpgradeStatus.PENDING),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(100).optional(),
});

export const rejectUpgradeSchema = z.object({
  reason: z.enum(UpgradeRejectionReason, { error: "Choose why the ID can't be accepted" }),
  // Shown to the user with the reason
  message: z.string().trim().max(300, "Keep the message under 300 characters").optional(),
});
