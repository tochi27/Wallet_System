import { z } from "zod";
import { newPasswordSchema } from "./auth.validators";
import { isValidTimeZone } from "./wallet.validators";

// Repeated digits and straight runs are the first PINs anyone tries
const isGuessable = (pin: string) => {
  if (/^(\d)\1{3}$/.test(pin)) return true;
  const ascending = "0123456789";
  const descending = "9876543210";
  return ascending.includes(pin) || descending.includes(pin);
};

const pin = z
  .string({ error: "Your PIN must be 4 digits" })
  .regex(/^\d{4}$/, "Your PIN must be 4 digits")
  .refine((value) => !isGuessable(value), "Choose a less guessable PIN (not 1111 or 1234)");

export const setPinSchema = z.object({
  password: z.string({ error: "Enter your account password" }).min(1, "Enter your account password"),
  pin,
});

export const changePinSchema = z
  .object({
    currentPin: z.string().regex(/^\d{4}$/, "Your current PIN is 4 digits").optional(),
    password: z.string().min(1).optional(),
    newPin: pin,
  })
  .refine((body) => body.currentPin || body.password, "Enter your current PIN or your password");

export const preferencesSchema = z
  .object({
    emailNotifications: z.boolean({ error: "emailNotifications must be true or false" }).optional(),
    // Opting in to AI insights; the timezone is used for the first insights generated
    aiInsightsEnabled: z.boolean({ error: "aiInsightsEnabled must be true or false" }).optional(),
    timezone: z
      .string()
      .optional()
      .default("UTC")
      .refine(isValidTimeZone, "timezone must be a valid IANA timezone, e.g. Africa/Lagos"),
  })
  .refine((body) => body.emailNotifications !== undefined || body.aiInsightsEnabled !== undefined, "Nothing to update");

export const changePasswordSchema = z.object({
  currentPassword: z.string({ error: "Enter your current password" }).min(1, "Enter your current password"),
  newPassword: newPasswordSchema,
});
