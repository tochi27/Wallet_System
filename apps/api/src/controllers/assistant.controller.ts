import { Request, Response } from "express";
import logger from "../config/logger";
import { askAssistant, AssistantError } from "../services/assistant/assistant.service";
import { errorResponse, successResponse } from "../utils/response.utils";

export const ask = async (req: Request, res: Response) => {
  try {
    const answer = await askAssistant(req.userId, req.body);
    return successResponse(res, "Answered", answer);
  } catch (err) {
    if (err instanceof AssistantError) return errorResponse(res, err.message, err.status);
    logger.error({ err }, "Assistant failed");
    return errorResponse(res, "The assistant ran into a problem", 500);
  }
};
