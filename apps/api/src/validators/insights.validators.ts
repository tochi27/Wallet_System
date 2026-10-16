import { SpendingCategory } from "@prisma/client";
import { z } from "zod";
import { isValidTimeZone } from "./wallet.validators";

// The user's timezone decides where "today" and each 30-day period start
const timezone = z
  .string()
  .optional()
  .default("UTC")
  .refine(isValidTimeZone, "timezone must be a valid IANA timezone, e.g. Africa/Lagos");

export const insightsQuerySchema = z.object({ timezone });

export const refreshInsightsSchema = z.object({ timezone });

export const categorySchema = z.object({
  category: z.enum(SpendingCategory, { error: `category must be one of ${Object.values(SpendingCategory).join(", ")}` }),
});
