import { Request, Response, NextFunction } from "express";
import { env } from "../config/env";
import { errorResponse } from "../utils/response.utils";

/**
 * Guards endpoints that create or remove money with no real payment behind them (direct credit,
 * direct debit, user-initiated reversal). Real money moves through Paystack deposits and
 * withdrawals; these stay available for development and tests via DIRECT_FUNDING_ENABLED.
 */
export const requireDirectFunding = (_req: Request, res: Response, next: NextFunction) => {
  if (env.DIRECT_FUNDING_ENABLED) return next();
  return errorResponse(
    res,
    "This action is disabled. Add money with a Paystack deposit, or withdraw to a bank account.",
    403
  );
};
