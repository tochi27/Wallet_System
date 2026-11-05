import { Request, Response, NextFunction } from "express";
import prisma from "../config/db";
import { isDemoEmail } from "../config/demo";
import logger from "../config/logger";
import { errorResponse } from "../utils/response.utils";

/**
 * Stops changes that would lock other visitors out of a shared demo account (its password and
 * PIN). 403, never 401, so the app doesn't sign the visitor out. If the lookup fails, the request
 * carries on: this only protects demo logins, and the route checks the user again itself.
 */
export const blockDemoAccount =
  (what: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const user = await prisma.user
      .findUnique({ where: { id: req.userId }, select: { email: true } })
      .catch((err: unknown) => {
        logger.warn({ err, userId: req.userId }, "Could not check for a demo account");
        return null;
      });
    if (user && isDemoEmail(user.email)) {
      return errorResponse(res, `This is the shared demo account, so its ${what} can't be changed. Sign up for your own account to try this.`, 403);
    }
    next();
  };
