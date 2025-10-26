import { Request, Response } from "express";
import {
  creditWallet,
  debitWallet,
  getBalance,
  getTransactions,
} from "../services/wallet.service";
import { errorResponse, successResponse } from "../utils/response.utils";
import { validateAmount } from "../utils/validateAmount.utils";

// Credit controller
export const credit = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const amount = validateAmount(req.body.amount);
    const wallet = await creditWallet(req.userId, amount);

    return successResponse(res, "Wallet credited successfully", wallet, 200);
  } catch (err: any) {
    return errorResponse(res, err.message || "Failed to credit wallet", 500);
  }
};

// Debit controller
export const debit = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const amount = validateAmount(req.body.amount);
    const currentBalance = await getBalance(req.userId);

    if (!currentBalance) {
      return errorResponse(res, "Wallet not found for this user", 500);
    }
    if (amount > currentBalance.balance) {
      return errorResponse(res, "Insufficient balance", 500);
    }

    const wallet = await debitWallet(req.userId, amount);
    return successResponse(res, "Wallet debited successfully", wallet, 200);
  } catch (err: any) {
    return errorResponse(res, err.message || "Failed to debit wallet", 500);
  }
};

// Balance controller
export const balance = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const wallet = await getBalance(req.userId);
    return successResponse(res, "Wallet balance fetched successfully", wallet, 200);
  } catch (err: any) {
    return errorResponse(res, err.message || "Failed to fetch balance", 500);
  }
};

// Transactions controller
export const transactions = async (req: Request, res: Response) => {
  try {
    if (!req.userId) return errorResponse(res, "User ID not found in request", 500);

    const txs = await getTransactions(req.userId);
    return successResponse(res, "Transaction history fetched successfully", txs, 200);
  } catch (err: any) {
    return errorResponse(res, err.message || "Failed to fetch transactions", 500);
  }
};
