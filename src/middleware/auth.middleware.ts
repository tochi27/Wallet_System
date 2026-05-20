import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
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
    };

    // Validate user existence in DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { wallet: true },
    });

    if (!user) {
      return errorResponse(res, "User not found or no longer exists", 404);
    }

    // Attach user info to request
    req.userId = user.id;
    req.token = token;

    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ err: message }, "JWT verification failed");
    return errorResponse(res, "Invalid or expired token", 403);
  }
};
