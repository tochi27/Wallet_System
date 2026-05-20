import { Request, Response } from "express";
import {
  registerWebhook,
  listWebhooks,
  deleteWebhook,
  getDeliveries,
} from "../services/webhook.service";
import { errorResponse, successResponse } from "../utils/response.utils";

export const register = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { url, events } = req.body;
    const webhook = await registerWebhook(req.userId, url, events);

    return successResponse(
      res,
      "Webhook registered. Save the secret — it will not be shown again.",
      webhook,
      201
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to register webhook";
    return errorResponse(res, message, 500);
  }
};

export const list = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const webhooks = await listWebhooks(req.userId);
    return successResponse(res, "Webhooks fetched successfully", webhooks, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch webhooks";
    return errorResponse(res, message, 500);
  }
};

export const remove = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { webhookId } = req.params;
    await deleteWebhook(webhookId, req.userId);

    return successResponse(res, "Webhook deleted successfully", null, 200);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to delete webhook";
    const status = message === "Webhook not found" ? 404 : 500;
    return errorResponse(res, message, status);
  }
};

export const deliveries = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const { webhookId } = req.params;
    const items = await getDeliveries(webhookId, req.userId);
    return successResponse(res, "Delivery history fetched successfully", items);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch delivery history";
    const status = message === "Webhook not found" ? 404 : 500;
    return errorResponse(res, message, status);
  }
};
