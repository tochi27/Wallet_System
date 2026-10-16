import { Request, Response } from "express";
import logger from "../config/logger";
import { getInsights, InsightsError, requestRefresh, setTransactionCategory } from "../services/insights/insights.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import { insightsQuerySchema } from "../validators/insights.validators";

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof InsightsError) return errorResponse(res, err.message, err.status);
  logger.error({ err }, fallback);
  return errorResponse(res, fallback, 500);
};

export const insights = async (req: Request, res: Response) => {
  const parsed = insightsQuerySchema.safeParse(req.query);
  if (!parsed.success) return errorResponse(res, parsed.error.issues[0]?.message ?? "Invalid query", 400);
  try {
    return successResponse(res, "Insights fetched", await getInsights(req.userId, parsed.data.timezone));
  } catch (err) {
    return fail(res, err, "Could not fetch insights");
  }
};

export const refreshInsights = async (req: Request, res: Response) => {
  try {
    await requestRefresh(req.userId, req.body.timezone);
    return successResponse(res, "Refreshing your insights", { refreshing: true }, 202);
  } catch (err) {
    return fail(res, err, "Could not refresh insights");
  }
};

export const updateCategory = async (req: Request, res: Response) => {
  try {
    const transaction = await setTransactionCategory(req.userId, String(req.params.transactionId), req.body.category);
    return successResponse(res, "Category saved", transaction);
  } catch (err) {
    return fail(res, err, "Could not save the category");
  }
};
