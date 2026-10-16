import { Request, Response, NextFunction } from "express";
import logger from "../config/logger";
import { PIN_PATTERN, PinError, verifyPin } from "../services/security/pin.service";
import { errorResponse } from "../utils/response.utils";

/**
 * Requires the user's transaction PIN (body field `pin`) before money leaves the wallet. Runs
 * after body validation, so a malformed request never costs the user a PIN attempt.
 */
export const requirePin = async (req: Request, res: Response, next: NextFunction) => {
  const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
  if (!PIN_PATTERN.test(pin)) return errorResponse(res, "Enter your 4-digit transaction PIN", 400);

  try {
    await verifyPin(req.userId, pin);
    next();
  } catch (err) {
    if (err instanceof PinError) return errorResponse(res, err.message, err.status);
    logger.error({ err }, "PIN check failed");
    return errorResponse(res, "Could not check your PIN", 500);
  }
};
