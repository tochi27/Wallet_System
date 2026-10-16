import { Request, Response } from "express";
import { getLimits } from "../services/limits.service";
import logger from "../config/logger";
import { findUserById, updatePreferences } from "../services/auth.service";
import { setInsightsEnabled } from "../services/insights/insights.service";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "../services/notifications/notification.service";
import { changePassword, PasswordError } from "../services/security/password.service";
import { changePin, PinError, setPin } from "../services/security/pin.service";
import { generateToken } from "../utils/jwt.utils";
import { errorResponse, successResponse } from "../utils/response.utils";
import { revokeToken } from "../utils/tokenBlacklist.utils";

const fail = (res: Response, err: unknown, fallback: string) => {
  if (err instanceof PinError || err instanceof PasswordError) return errorResponse(res, err.message, err.status);
  logger.error({ err }, fallback);
  return errorResponse(res, fallback, 500);
};

// ---------- Transaction PIN ----------

export const createPin = async (req: Request, res: Response) => {
  try {
    await setPin(req.userId, req.body.password, req.body.pin);
    return successResponse(res, "Transaction PIN set", { hasPin: true }, 200);
  } catch (err) {
    return fail(res, err, "Could not set PIN");
  }
};

export const updatePin = async (req: Request, res: Response) => {
  try {
    await changePin(req.userId, { currentPin: req.body.currentPin, password: req.body.password }, req.body.newPin);
    return successResponse(res, "Transaction PIN changed", { hasPin: true }, 200);
  } catch (err) {
    return fail(res, err, "Could not change PIN");
  }
};

// ---------- Password ----------

export const updatePassword = async (req: Request, res: Response) => {
  try {
    await changePassword(req.userId, req.body.currentPassword, req.body.newPassword);
    // Every session is now signed out, this one included; it carries on with a fresh token
    await revokeToken(req.token);
    return successResponse(res, "Password changed", { token: generateToken(req.userId) }, 200);
  } catch (err) {
    return fail(res, err, "Could not change password");
  }
};

// ---------- Preferences ----------

export const savePreferences = async (req: Request, res: Response) => {
  try {
    const { emailNotifications, aiInsightsEnabled, timezone } = req.body;
    if (aiInsightsEnabled !== undefined) await setInsightsEnabled(req.userId, aiInsightsEnabled, timezone);
    const user = emailNotifications !== undefined ? await updatePreferences(req.userId, { emailNotifications }) : await findUserById(req.userId);
    return successResponse(res, "Preferences saved", { user }, 200);
  } catch (err) {
    return fail(res, err, "Could not save preferences");
  }
};

// ---------- Notifications ----------

export const notifications = async (req: Request, res: Response) => {
  try {
    return successResponse(res, "Notifications fetched successfully", await listNotifications(req.userId), 200);
  } catch (err) {
    return fail(res, err, "Could not fetch notifications");
  }
};

export const readNotification = async (req: Request, res: Response) => {
  try {
    await markNotificationRead(req.userId, String(req.params.id));
    return successResponse(res, "Notification marked as read", {}, 200);
  } catch (err) {
    return fail(res, err, "Could not update notification");
  }
};

export const readAllNotifications = async (req: Request, res: Response) => {
  try {
    await markAllNotificationsRead(req.userId);
    return successResponse(res, "All notifications marked as read", {}, 200);
  } catch (err) {
    return fail(res, err, "Could not update notifications");
  }
};

// Account limits controller: the user's tier, limits and today's usage
export const limits = async (req: Request, res: Response): Promise<any> => {
  try {
    return successResponse(res, "Limits fetched", await getLimits(req.userId), 200);
  } catch (error) {
    logger.error({ err: error, userId: req.userId }, "Could not load limits");
    return errorResponse(res, "Could not load your limits", 500);
  }
};
