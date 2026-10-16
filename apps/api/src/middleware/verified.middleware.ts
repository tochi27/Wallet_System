import { Request, Response, NextFunction } from "express";
import { errorResponse } from "../utils/response.utils";

export const EMAIL_UNVERIFIED_MESSAGE =
  "Verify your email to move money. We sent a link to your inbox, and you can ask for a new one from the banner at the top of the app.";

/**
 * Blocks every way of moving money (adding, sending, withdrawing, saving bank accounts) until
 * the user has verified their email. Viewing the wallet and settings still works. 403, never
 * 401, so the app doesn't sign the user out.
 */
export const requireVerifiedEmail = (req: Request, res: Response, next: NextFunction) => {
  if (!req.emailVerified) return errorResponse(res, EMAIL_UNVERIFIED_MESSAGE, 403);
  next();
};
