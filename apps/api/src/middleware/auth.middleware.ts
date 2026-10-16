import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { Role } from "@prisma/client";
import { errorResponse } from "../utils/response.utils";
import prisma from "../config/db";
import logger from "../config/logger";
import { env } from "../config/env";
import {
  addToBlacklistWithExpiry,
  isBlacklisted,
} from "../utils/tokenBlacklist.utils";

declare module "express-serve-static-core" {
  interface Request {
    userId: string;
    token: string;
    userRole?: Role;
    accountFrozen?: boolean;
    emailVerified?: boolean;
  }
}

export const authenticate = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) return errorResponse(res, "No token provided", 401);

  const token = authHeader.split(" ")[1];

  if (!token) return errorResponse(res, "Invalid authorization format", 401);

  try {
    if (await isBlacklisted(token)) {
      return errorResponse(res, "Token blacklisted, please login", 401);
    }
    // Verify and decode token
    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      userId: string;
      iat?: number;
    };

    // Validate user existence in DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, passwordChangedAt: true, role: true, frozenAt: true, emailVerifiedAt: true },
    });

    if (!user) {
      return errorResponse(res, "User not found or no longer exists", 401);
    }

    // Changing the password signs out every token issued before it (iat is in whole seconds)
    if (
      user.passwordChangedAt &&
      (decoded.iat ?? 0) < Math.floor(user.passwordChangedAt.getTime() / 1000)
    ) {
      return errorResponse(res, "Your password was changed. Please log in again.", 401);
    }

    // Attach user info to request
    req.userId = user.id;
    req.token = token;
    // Read fresh on every request, so revoking an admin or freezing an account applies at once
    req.userRole = user.role;
    req.accountFrozen = Boolean(user.frozenAt);
    req.emailVerified = Boolean(user.emailVerifiedAt);

    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "JWT verification failed");
    return errorResponse(res, "Invalid or expired token", 401);
  }
};
