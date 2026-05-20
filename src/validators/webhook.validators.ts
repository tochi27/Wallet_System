import { z } from "zod";

const VALID_EVENTS = ["CREDIT", "DEBIT", "TRANSFER", "REVERSAL", "*"] as const;

export const registerWebhookSchema = z.object({
  url: z.url("Invalid webhook URL"),
  events: z
    .array(z.enum(VALID_EVENTS), { error: "events must be an array" })
    .min(1, "At least one event is required"),
});
