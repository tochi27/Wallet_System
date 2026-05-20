import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { errorResponse } from "../utils/response.utils";

export const validate =
  (schema: z.ZodSchema) =>
  (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const message = result.error.issues[0]?.message ?? "Validation failed";
      errorResponse(res, message, 400);
      return;
    }
    req.body = result.data;
    next();
  };
