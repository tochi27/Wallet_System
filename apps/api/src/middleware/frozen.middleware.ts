import { Request, Response, NextFunction } from "express";
import { errorResponse } from "../utils/response.utils";

export const ACCOUNT_FROZEN_MESSAGE = "Your account is on hold, so money can't be sent or withdrawn. Contact support.";

/**
 * Blocks money leaving a frozen account. Signing in, viewing and receiving money still work:
 * a deposit has already been paid at Paystack and must still be credited. 403, never 401, so
 * the app doesn't sign the user out.
 */
export const requireActiveAccount = (req: Request, res: Response, next: NextFunction) => {
  if (req.accountFrozen) return errorResponse(res, ACCOUNT_FROZEN_MESSAGE, 403);
  next();
};
