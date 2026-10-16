import { z } from "zod";
import { isValidTimeZone } from "./wallet.validators";

export const askSchema = z.object({
  message: z.string({ error: "Ask a question" }).trim().min(1, "Ask a question").max(500, "Keep your question under 500 characters"),
  // The conversation so far, kept by the browser (nothing is stored on the server)
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), text: z.string().max(2000) }))
    .max(20)
    .optional()
    .default([]),
  timezone: z
    .string()
    .optional()
    .default("UTC")
    .refine(isValidTimeZone, "timezone must be a valid IANA timezone, e.g. Africa/Lagos"),
});
